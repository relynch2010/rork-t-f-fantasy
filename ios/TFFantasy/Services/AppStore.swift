import Foundation
import SwiftUI
import UIKit

/// Every modal a league screen can raise. Presented once at the league root so any row can open them.
nonisolated enum LeagueSheet: Identifiable, Hashable, Sendable {
    case player(String)
    case breakdown(String, Int?)
    case weekProof(String, Int)
    case add(String)
    case trade(toId: String?, get: [String], counterOf: String?)
    case notifications
    case crop(Data)

    var id: String {
        switch self {
        case .player(let id): return "player-\(id)"
        case .breakdown(let id, let week): return "bd-\(id)-\(week ?? 0)"
        case .weekProof(let id, let week): return "proof-\(id)-\(week)"
        case .add(let id): return "add-\(id)"
        case .trade(let to, let get, let counter): return "trade-\(to ?? "")-\(get.joined())-\(counter ?? "")"
        case .notifications: return "notes"
        case .crop(let data): return "crop-\(data.count)"
        }
    }
}

struct DeepRoute: Equatable {
    let tab: LeagueTab
    let route: LeagueRoute
}

/// App-wide state: identity, league list, the open league (polled), and every league action.
@Observable
final class AppStore {
    private static let userKey = "td.account"
    private static let tokenKey = "session"
    private static let lastLeagueKey = "td.lastLeague"

    var user: UserProfile?
    var prefs: NotificationPrefs = NotificationPrefs()
    var leagues: [LeagueSummary] = []
    /// Set by a notification tap; the league root consumes it once the league is loaded.
    var pendingLink: NoteLink?
    /// Asks the league root to switch tabs (e.g. a matchup deep link).
    var requestedTab: LeagueTab?
    var league: LeagueState?
    var activeLeagueId: String?
    var errorMessage: String?
    var toast: String?
    var isBusy: Bool = false
    /// True until launch sign-in and loading finish (drives the splash screen).
    var isBooting: Bool = true
    var isLoadingLeague: Bool = false
    var athleteMap: [String: Athlete] = [:]
    var clockOffset: Double = 0
    var sheet: LeagueSheet?
    var showDraftRoom: Bool = false
    var isRealtimeConnected: Bool = false
    var lastUpdatedAt: Date?

    private var lineCache: [String: (version: Int, lines: [ScoreLine])] = [:]
    private var matchupCache: [String: (version: Int, lines: [ScoreLine])] = [:]
    private var projCache: [Int: (version: Int, data: WeekProjections)] = [:]
    private var rankCache: [Int: (version: Int, data: WaiverRankingsBody)] = [:]
    /// Bumped when the server signals a mock-draft change so an open mock room refreshes at once.
    var mockSignal: Int = 0
    private let api = APIClient()
    private var pollTask: Task<Void, Never>?
    private var socketTask: Task<Void, Never>?
    private var socket: URLSessionWebSocketTask?
    private var toastTask: Task<Void, Never>?

    init() {
        if let token = KeychainStore.get(Self.tokenKey),
           let data = UserDefaults.standard.data(forKey: Self.userKey),
           let saved = try? JSONDecoder().decode(UserProfile.self, from: data) {
            api.token = token
            user = saved
            activeLeagueId = UserDefaults.standard.string(forKey: Self.lastLeagueKey)
        }
        api.onUnauthorized = { [weak self] in
            Task { @MainActor in self?.handleExpiredSession() }
        }
        PushService.shared.onOpenLink = { [weak self] leagueId, link in
            self?.handlePushTap(leagueId: leagueId, link: link)
        }
        PushService.shared.flushPendingTap()
        PushService.shared.onRegistrationChange = { [weak self] in
            self?.schedulePushSync()
        }
    }

    // MARK: - Push registration

    private var pushSyncTask: Task<Void, Never>?
    private var lastPushSync: String = ""

    /// Debounced: saves this phone's OneSignal subscription (token, permission) to the signed-in account.
    func schedulePushSync() {
        pushSyncTask?.cancel()
        pushSyncTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled else { return }
            await self?.syncPushDevice(force: false)
        }
    }

    func syncPushDevice(force: Bool) async {
        guard user != nil else { return }
        let s = await PushService.shared.localState()
        guard let sub = s.subscriptionId, !sub.isEmpty else { return }
        let fingerprint = [user?.id ?? "", sub, s.tokenTail, s.permission, String(s.optedIn), s.onesignalId ?? ""].joined(separator: "|")
        if !force && fingerprint == lastPushSync { return }
        let body: [String: Any] = [
            "subscriptionId": sub, "onesignalId": s.onesignalId ?? "", "tokenTail": s.tokenTail, "hasToken": s.token != nil,
            "permission": s.permission, "optedIn": s.optedIn, "environment": PushService.apnsEnvironment,
            "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
            "device": UIDevice.current.model,
        ]
        do {
            try await api.registerPush(body)
            lastPushSync = fingerprint
        } catch {
            print("[Push] register failed: \(error.localizedDescription)")
        }
    }

    func pushStatus() async -> PushStatusBody? {
        let s = await PushService.shared.localState()
        do { return try await api.pushStatus(subscriptionId: s.subscriptionId) } catch { show(error); return nil }
    }

    func sendTestPush() async -> PushTestResult? {
        await syncPushDevice(force: true)
        let s = await PushService.shared.localState()
        do { return try await api.pushTest(subscriptionId: s.subscriptionId) } catch { show(error); return nil }
    }

    // MARK: - Bootstrap

    func bootstrap() async {
        let started = Date()
        defer {
            // Just long enough for the logo animation to land; never waits once loading took longer.
            let wait = max(0, 0.9 - Date().timeIntervalSince(started))
            Task { @MainActor [weak self] in
                if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
                self?.isBooting = false
            }
        }
        let cached = PushService.shared.cachedAppId
        if !cached.isEmpty { PushService.shared.configure(appId: cached) }
        if let user { PushService.shared.login(externalId: user.id) }
        LiveActivityService.shared.resumeObservers()
        if let config = try? await api.config() {
            PushService.shared.configure(appId: config.oneSignalAppId)
            if let user { PushService.shared.login(externalId: user.id) }
        }
        guard user != nil else { return }
        if let me = try? await api.me() { applyAuth(me) }
        await refreshLeagues()
        if let activeLeagueId { open(leagueId: activeLeagueId) }
    }

    // MARK: - Account

    private func applyAuth(_ auth: AuthResponse) {
        api.token = auth.token
        KeychainStore.set(auth.token, for: Self.tokenKey)
        user = auth.user
        if let p = auth.prefs { prefs = p }
        if let data = try? JSONEncoder().encode(auth.user) { UserDefaults.standard.set(data, forKey: Self.userKey) }
        PushService.shared.login(externalId: auth.user.id)
        schedulePushSync()
    }

    func signUp(email: String, password: String, name: String) async -> Bool {
        let ok = await authenticate { try await self.api.signUp(email: email, password: password, name: name) }
        if ok { PasswordVault.save(password, userId: user?.id) }
        return ok
    }

    func signIn(email: String, password: String) async -> Bool {
        let ok = await authenticate { try await self.api.signIn(email: email, password: password) }
        if ok { PasswordVault.save(password, userId: user?.id) }
        return ok
    }

    func confirmReset(email: String, code: String, password: String) async -> Bool {
        let ok = await authenticate { try await self.api.confirmReset(email: email, code: code, password: password) }
        if ok { PasswordVault.save(password, userId: user?.id) }
        return ok
    }

    /// Changes the password on the server (current password required). Only reports success after the server confirms.
    func changePassword(current: String, new password: String) async -> Bool {
        isBusy = true
        defer { isBusy = false }
        do {
            applyAuth(try await api.changePassword(current: current, password: password))
            PasswordVault.save(password, userId: user?.id)
            flash("Password changed. Other devices were signed out.")
            Haptics.success()
            return true
        } catch {
            show(error)
            return false
        }
    }

    func requestReset(email: String) async -> ResetResponse? {
        isBusy = true
        defer { isBusy = false }
        do { return try await api.requestReset(email: email) } catch { show(error); return nil }
    }

    private func authenticate(_ call: @escaping () async throws -> AuthResponse) async -> Bool {
        isBusy = true
        defer { isBusy = false }
        do {
            let auth = try await call()
            applyAuth(auth)
            await refreshLeagues()
            Haptics.success()
            return true
        } catch {
            show(error)
            return false
        }
    }

    func updateName(_ name: String) async {
        do { applyAuth(try await api.updateMe(name: name, prefs: nil)); flash("Name updated") } catch { show(error) }
    }

    func updatePrefs(_ next: NotificationPrefs) async {
        let previous = prefs
        prefs = next
        do { applyAuth(try await api.updateMe(name: nil, prefs: next)) } catch { prefs = previous; show(error) }
    }

    func signOut() {
        closeLeague()
        PasswordVault.clear()
        PushService.shared.logout()
        lastPushSync = ""
        api.token = nil
        KeychainStore.set(nil, for: Self.tokenKey)
        UserDefaults.standard.removeObject(forKey: Self.userKey)
        user = nil
        leagues = []
        prefs = NotificationPrefs()
    }

    func deleteAccount() async {
        do {
            try await api.deleteAccount()
            signOut()
        } catch {
            show(error)
        }
    }

    private func handleExpiredSession() {
        guard user != nil else { return }
        signOut()
        errorMessage = "Your session expired. Sign in again."
    }

    // MARK: - Deep links

    private func handlePushTap(leagueId: String?, link: NoteLink?) {
        guard user != nil else { return }
        pendingLink = link
        if let leagueId, leagueId != activeLeagueId || league == nil {
            open(leagueId: leagueId)
        }
    }

    /// Routes a notification link to its screen. Called by the league root once the league has loaded.
    func consumePendingLink() {
        guard let link = pendingLink, let league else { return }
        pendingLink = nil
        open(link: link, in: league)
    }

    func open(link: NoteLink, in league: LeagueState) {
        switch link.type {
        case "player":
            if let id = link.id, athleteMap[id] != nil { sheet = .player(id) }
        case "draft":
            sheet = nil
            if league.phaseKind == .drafting { showDraftRoom = true } else { go(.league, .draft) }
        case "matchup":
            sheet = nil
            if let w = link.week, w != league.displayWeek { go(.matchup, .matchup(league.me, w)) } else { requestedTab = .matchup }
        case "trades":
            sheet = nil
            go(.league, .trades)
        case "transactions", "activity":
            sheet = nil
            go(.league, .transactions)
        case "playoffs":
            sheet = nil
            go(.league, .playoffs)
        default:
            break
        }
    }

    private func go(_ tab: LeagueTab, _ route: LeagueRoute) {
        requestedTab = tab
        deepRoute = DeepRoute(tab: tab, route: route)
    }

    /// A screen a tab's navigation stack should push after a deep link.
    var deepRoute: DeepRoute?

    // MARK: - Leagues

    func refreshLeagues() async {
        guard user != nil else { return }
        do {
            leagues = try await api.myLeagues()
        } catch {
            print("[Store] leagues failed: \(error.localizedDescription)")
        }
    }

    func createLeague(name: String, teamName: String, school: String = "", settings: [String: Any]) async -> Bool {
        guard user != nil else { return false }
        isBusy = true
        defer { isBusy = false }
        do {
            let state = try await api.createLeague(name: name, teamName: teamName, school: school, settings: settings)
            apply(state)
            activate(state.id)
            await refreshLeagues()
            Haptics.success()
            return true
        } catch {
            show(error)
            return false
        }
    }

    /// Schools with players on file, for the create-league picker. Empty if it can't load (typing a school still works).
    func schools() async -> [SchoolOption] {
        (try? await api.schools()) ?? []
    }

    func joinLeague(code: String, teamName: String) async -> Bool {
        guard user != nil else { return false }
        isBusy = true
        defer { isBusy = false }
        do {
            let state = try await api.joinLeague(code: code, teamName: teamName)
            apply(state)
            activate(state.id)
            await refreshLeagues()
            Haptics.success()
            return true
        } catch {
            show(error)
            return false
        }
    }

    func open(leagueId: String) {
        if league?.id != leagueId {
            league = nil
            lineCache = [:]
            showDraftRoom = false
        }
        activate(leagueId)
    }

    func closeLeague() {
        pollTask?.cancel()
        pollTask = nil
        stopRealtime()
        activeLeagueId = nil
        league = nil
        sheet = nil
        showDraftRoom = false
        lineCache = [:]
        matchupCache = [:]
        projCache = [:]
        rankCache = [:]
        UserDefaults.standard.removeObject(forKey: Self.lastLeagueKey)
        Task { await refreshLeagues() }
    }

    private func activate(_ leagueId: String) {
        activeLeagueId = leagueId
        UserDefaults.standard.set(leagueId, forKey: Self.lastLeagueKey)
        startPolling()
        startRealtime()
    }

    /// Safety-net polling. With the realtime channel up, it only runs occasionally.
    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.fetchLeague()
                let interval: Double
                if self.isRealtimeConnected {
                    interval = 30
                } else if self.league?.phaseKind == .drafting {
                    interval = 2.5
                } else if (self.league?.liveMeetCount ?? 0) > 0 {
                    interval = 5
                } else {
                    interval = 10
                }
                try? await Task.sleep(for: .seconds(interval))
            }
        }
    }

    // MARK: - Realtime

    /// Keeps a WebSocket to the league open. Every server change pushes a signal and we pull the new state at once.
    private func startRealtime() {
        stopRealtime()
        guard let token = api.token, let leagueId = activeLeagueId else { return }
        socketTask = Task { [weak self] in
            var backoff: Double = 1
            while !Task.isCancelled {
                guard let self, let url = APIClient.socketURL(leagueId: leagueId, token: token) else { return }
                let ws = URLSession.shared.webSocketTask(with: url)
                self.socket = ws
                ws.resume()
                let pinger = Task {
                    while !Task.isCancelled {
                        try? await Task.sleep(for: .seconds(25))
                        try? await ws.send(.string("ping"))
                    }
                }
                do {
                    while !Task.isCancelled {
                        let message = try await ws.receive()
                        if !self.isRealtimeConnected {
                            self.isRealtimeConnected = true
                            backoff = 1
                        }
                        let text: String
                        switch message {
                        case .string(let s): text = s
                        case .data(let d): text = String(decoding: d, as: UTF8.self)
                        @unknown default: text = ""
                        }
                        guard let data = text.data(using: .utf8),
                              let msg = try? JSONDecoder().decode(SocketMessage.self, from: data) else { continue }
                        if msg.type == "deleted" {
                            pinger.cancel()
                            self.leagueRemoved("This league was deleted by the commissioner.")
                            return
                        }
                        if msg.type == "mock" { self.mockSignal &+= 1; continue }
                        if msg.type == "state" || msg.type == "hello", let v = msg.version, v != self.league?.version {
                            await self.fetchLeague()
                        }
                    }
                } catch {
                    print("[Realtime] disconnected: \(error.localizedDescription)")
                }
                pinger.cancel()
                ws.cancel(with: .goingAway, reason: nil)
                self.isRealtimeConnected = false
                if Task.isCancelled { return }
                try? await Task.sleep(for: .seconds(backoff))
                backoff = min(20, backoff * 2)
            }
        }
    }

    private func stopRealtime() {
        socketTask?.cancel()
        socketTask = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        isRealtimeConnected = false
    }

    /// App came back to the foreground: restore the server state and reconnect.
    func resume() {
        if user != nil {
            Task {
                await PushService.shared.optInIfAllowed()
                schedulePushSync()
            }
        }
        guard activeLeagueId != nil else { return }
        Task { await fetchLeague(force: true) }
        if !isRealtimeConnected { startRealtime() }
    }

    func fetchLeague(force: Bool = false) async {
        guard user != nil, let leagueId = activeLeagueId else { return }
        if league == nil { isLoadingLeague = true }
        defer { isLoadingLeague = false }
        do {
            let since = force ? nil : (league?.id == leagueId ? league?.version : nil)
            if let state = try await api.state(leagueId: leagueId, since: since) {
                apply(state)
            }
        } catch let error as APIError where error.status == 403 || error.status == 404 {
            leagueRemoved(error.status == 404 ? "This league no longer exists." : error.message)
        } catch {
            print("[Store] poll failed: \(error.localizedDescription)")
        }
    }

    /// The league was deleted or access ended: drop everything and go back to the league list.
    func leagueRemoved(_ message: String) {
        guard activeLeagueId != nil else { return }
        closeLeague()
        errorMessage = message
        Haptics.warning()
    }

    // MARK: - League list management

    func setHidden(_ leagueId: String, hidden: Bool) async {
        do {
            try await api.setHidden(leagueId: leagueId, hidden: hidden)
            await refreshLeagues()
            flash(hidden ? "Hidden from Home" : "Back on Home")
            Haptics.success()
        } catch {
            show(error)
        }
    }

    /// Commissioner only. The server checks the role and the typed name, then deletes atomically.
    func deleteLeague(confirmName: String) async -> Bool {
        guard let leagueId = activeLeagueId else { return false }
        isBusy = true
        defer { isBusy = false }
        do {
            try await api.deleteLeague(leagueId: leagueId, confirmName: confirmName)
            closeLeague()
            flash("League deleted")
            Haptics.success()
            return true
        } catch {
            show(error)
            return false
        }
    }

    func previewCoInvite(code: String) async -> CoInvitePreview? {
        do { return try await api.coPreview(code: code) } catch { show(error); return nil }
    }

    func acceptCoInvite(code: String) async -> Bool {
        isBusy = true
        defer { isBusy = false }
        do {
            let info = try await api.coAccept(code: code)
            await refreshLeagues()
            open(leagueId: info.leagueId)
            Haptics.success()
            return true
        } catch {
            show(error)
            return false
        }
    }

    func declineCoInvite(code: String) async {
        do { try await api.coDecline(code: code); flash("Invite declined") } catch { show(error) }
    }

    // MARK: - Projections

    /// Week projections, cached per league version (recomputed server-side only when inputs change).
    func projections(week: Int) async -> WeekProjections? {
        guard user != nil, let leagueId = activeLeagueId else { return nil }
        let version = league?.version ?? -1
        if let cached = projCache[week], cached.version == version { return cached.data }
        do {
            let data = try await api.projections(leagueId: leagueId, week: week)
            projCache[week] = (version, data)
            return data
        } catch {
            print("[Store] projections failed: \(error.localizedDescription)")
            return projCache[week]?.data
        }
    }

    func weekBreakdown(_ athleteId: String, week: Int) async -> WeekBreakdown? {
        guard user != nil, let leagueId = activeLeagueId else { return nil }
        do { return try await api.breakdown(leagueId: leagueId, week: week, athleteId: athleteId, teamId: nil, as: WeekBreakdown.self) } catch { show(error); return nil }
    }

    func teamBreakdown(_ teamId: String, week: Int) async -> TeamBreakdown? {
        guard user != nil, let leagueId = activeLeagueId else { return nil }
        do { return try await api.breakdown(leagueId: leagueId, week: week, athleteId: nil, teamId: teamId, as: TeamBreakdown.self) } catch { show(error); return nil }
    }

    /// Commissioner tools (reconcile, health, notification log, snapshots, previews, versions). Read-only on the server.
    func tool<T: Decodable>(_ body: [String: Any], as type: T.Type) async -> T? {
        guard user != nil, let leagueId = activeLeagueId else { return nil }
        do { return try await api.tool(leagueId: leagueId, body: body, as: type) } catch { show(error); return nil }
    }

    /// Waiver / free-agent rankings, cached per league version.
    func rankings(week: Int) async -> WaiverRankingsBody? {
        guard user != nil, let leagueId = activeLeagueId else { return nil }
        let version = league?.version ?? -1
        if let cached = rankCache[week], cached.version == version { return cached.data }
        do {
            let data = try await api.rankings(leagueId: leagueId, week: week)
            rankCache[week] = (version, data)
            return data
        } catch {
            print("[Store] rankings failed: \(error.localizedDescription)")
            return rankCache[week]?.data
        }
    }

    func explainProjection(_ athleteId: String, week: Int) async -> ProjectionExplanation? {
        guard user != nil, let leagueId = activeLeagueId else { return nil }
        return try? await api.explain(leagueId: leagueId, athleteId: athleteId, week: week).explanation
    }

    func athleteProjection(_ athleteId: String, week: Int) async -> AthleteProjectionBody? {
        guard user != nil, let leagueId = activeLeagueId else { return nil }
        return try? await api.athleteProjection(leagueId: leagueId, athleteId: athleteId, week: week)
    }

    // MARK: - Mock drafts

    func mock(_ mockId: String?) async -> MockBody? {
        guard user != nil, let leagueId = activeLeagueId else { return nil }
        do { return try await api.mock(leagueId: leagueId, mockId: mockId) } catch { if mockId != nil { show(error) }; return nil }
    }

    func mockOp(_ body: [String: Any]) async -> MockBody? {
        guard user != nil, let leagueId = activeLeagueId else { return nil }
        do {
            let out = try await api.mockOp(leagueId: leagueId, body: body)
            Haptics.success()
            return out
        } catch {
            show(error)
            return nil
        }
    }

    private func apply(_ state: LeagueState) {
        let previous = league
        // A slow background response must never replace newer confirmed data (versions only move forward).
        if let previous, previous.id == state.id, state.version < previous.version {
            print("[Store] ignored stale state v\(state.version) < v\(previous.version)")
            return
        }
        if previous?.athletes != state.athletes || athleteMap.isEmpty {
            athleteMap = Dictionary(state.athletes.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        }
        clockOffset = state.serverNow - Date().timeIntervalSince1970 * 1000
        if let previous, previous.id == state.id {
            if previous.teamOnClock != state.me, state.teamOnClock == state.me { Haptics.warning() }
            if previous.phaseKind == .predraft, state.phaseKind == .drafting { showDraftRoom = true }
        } else if state.phaseKind == .drafting {
            showDraftRoom = true
        }
        withAnimation(.snappy) { league = state }
        lastUpdatedAt = .now
        Task { await syncLiveActivity(state) }
    }

    // MARK: - Actions

    @discardableResult
    func perform(_ body: [String: Any], success: String? = nil) async -> Bool {
        guard user != nil, let leagueId = activeLeagueId else { return false }
        isBusy = true
        defer { isBusy = false }
        do {
            let state = try await api.action(leagueId: leagueId, body: body)
            apply(state)
            if let success { flash(success) }
            Haptics.success()
            return true
        } catch {
            show(error)
            return false
        }
    }

    /// Scoring lines for one athlete (cached per league version).
    func lines(for athleteId: String) async -> [ScoreLine] {
        guard user != nil, let leagueId = activeLeagueId else { return [] }
        let version = league?.version ?? -1
        if let cached = lineCache[athleteId], cached.version == version { return cached.lines }
        do {
            let lines = try await api.athleteLines(leagueId: leagueId, athleteId: athleteId)
            lineCache[athleteId] = (version, lines)
            return lines
        } catch {
            print("[Store] lines failed: \(error.localizedDescription)")
            return lineCache[athleteId]?.lines ?? []
        }
    }

    /// Scoring lines for the two rosters in a matchup (cached per league version).
    func matchupLines(week: Int, teamId: String) async -> [ScoreLine] {
        guard user != nil, let leagueId = activeLeagueId else { return [] }
        let key = "\(week)|\(teamId)"
        let version = league?.version ?? -1
        if let cached = matchupCache[key], cached.version == version { return cached.lines }
        do {
            let body = try await api.matchupLines(leagueId: leagueId, week: week, teamId: teamId)
            matchupCache[key] = (version, body.lines)
            return body.lines
        } catch {
            print("[Store] matchup lines failed: \(error.localizedDescription)")
            return matchupCache[key]?.lines ?? []
        }
    }

    /// Every league and whether it's on the current global setup (Main League commissioner only).
    func globalLeagues() async -> GlobalLeaguesBody? {
        guard user != nil else { return nil }
        do { return try await api.globalLeagues() } catch { show(error); return nil }
    }

    func meetLab(_ body: [String: Any]) async -> MeetTestResult? {
        guard user != nil, let leagueId = activeLeagueId else { return nil }
        do {
            return try await api.meetLab(leagueId: leagueId, body: body)
        } catch {
            show(error)
            return nil
        }
    }

    func testMeet(_ body: [String: Any]) async -> MeetTestResult? {
        guard user != nil, let leagueId = activeLeagueId else { return nil }
        do {
            return try await api.meetTest(leagueId: leagueId, body: body)
        } catch {
            show(error)
            return nil
        }
    }

    /// Uploads an already-cropped square image (≤ 400px) as the team photo.
    func uploadTeamPhoto(_ image: UIImage) async -> Bool {
        guard user != nil, let leagueId = activeLeagueId else { return false }
        guard let jpeg = image.jpegData(compressionQuality: 0.8) else {
            errorMessage = "That photo couldn't be read."
            return false
        }
        isBusy = true
        defer { isBusy = false }
        do {
            let state = try await api.uploadAvatar(leagueId: leagueId, base64: jpeg.base64EncodedString())
            apply(state)
            flash("Team photo updated")
            Haptics.success()
            return true
        } catch {
            show(error)
            return false
        }
    }

    /// Saves a processed headshot for one athlete in this league. Only shown as saved once the server confirms.
    func saveAthletePhoto(athleteId: String, jpeg: Data?, expectAt: Double?) async -> Bool {
        guard user != nil, let leagueId = activeLeagueId else { return false }
        isBusy = true
        defer { isBusy = false }
        do {
            let state = try await api.uploadAthletePhoto(leagueId: leagueId, athleteId: athleteId, base64: jpeg?.base64EncodedString(), expectAt: expectAt)
            apply(state)
            flash(jpeg == nil ? "Photo removed" : "Photo saved")
            Haptics.success()
            return true
        } catch {
            show(error)
            if (error as? APIError)?.status == 400 { await fetchLeague(force: true) }
            return false
        }
    }

    func athletePhotoURL(_ athlete: Athlete?) -> URL? {
        guard let path = athlete?.photo, !path.isEmpty else { return nil }
        return URL(string: APIClient.base + path)
    }

    func avatarURL(for team: Team?) -> URL? {
        guard let team, let at = team.avatarAt, let leagueId = league?.id ?? activeLeagueId else { return nil }
        return APIClient.avatarURL(leagueId: leagueId, teamId: team.id, version: at)
    }

    func scoringData() async -> ScoringData? {
        guard user != nil, let leagueId = activeLeagueId else { return nil }
        do {
            return try await api.scoring(leagueId: leagueId)
        } catch {
            show(error)
            return nil
        }
    }

    func previewResult(_ body: [String: Any]) async -> ResultPreview? {
        guard user != nil, let leagueId = activeLeagueId else { return nil }
        do {
            return try await api.preview(leagueId: leagueId, body: body)
        } catch {
            show(error)
            return nil
        }
    }

    // MARK: - Lookups

    func athlete(_ id: String?) -> Athlete? {
        guard let id else { return nil }
        return athleteMap[id]
    }

    func ownerOf(_ athleteId: String) -> Team? {
        league?.owner(of: athleteId)
    }

    func seasonPoints(_ athleteId: String) -> Double {
        league?.seasonPoints(athleteId) ?? 0
    }

    var serverNowMs: Double { Date().timeIntervalSince1970 * 1000 + clockOffset }

    var unreadCount: Int { league?.unreadCount ?? 0 }

    /// Server-synced read state: marking here marks it on every device signed into this account.
    func markRead(_ ids: [String]) async {
        guard !ids.isEmpty, let leagueId = activeLeagueId else { return }
        if let state = try? await api.action(leagueId: leagueId, body: ["type": "markRead", "ids": ids]) { apply(state) }
    }

    func markAllRead() async {
        guard let leagueId = activeLeagueId, unreadCount > 0 else { return }
        do {
            apply(try await api.action(leagueId: leagueId, body: ["type": "markRead", "all": true]))
            Haptics.success()
        } catch {
            show(error)
        }
    }

    /// Opens the add flow: adds directly when there's room, otherwise asks who to drop / how much to bid.
    func requestAdd(_ athleteId: String) {
        guard let league, let me = league.myTeam else { return }
        Haptics.tap()
        if let bad = league.irProblem(for: me.id, athletes: athleteMap) {
            errorMessage = "\(bad.name) is no longer on IR. Move them out of the IR spot before adding players."
            Haptics.error()
            return
        }
        let isWaiver = league.waivers[athleteId] != nil
        if !isWaiver, let a = athlete(athleteId), league.hasOpenSpot(for: a, team: me) {
            Task { await perform(["type": "addDrop", "addId": athleteId], success: "Added \(athlete(athleteId)?.name ?? "athlete")") }
            return
        }
        sheet = .add(athleteId)
    }

    // MARK: - Live Activity

    func liveActivityId(for state: LeagueState) -> String? {
        guard state.phaseKind == .season || state.phaseKind == .complete, state.myTeam != nil else { return nil }
        return LeagueState.liveActivityId(leagueId: state.id, week: state.displayWeek, teamId: state.me)
    }

    func startLiveActivity() {
        guard let state = league, let me = state.myTeam, let id = liveActivityId(for: state) else { return }
        let week = state.displayWeek
        let opp = state.matchup(for: me.id, week: week).flatMap { state.team($0.opponent(of: me.id)) }
        let attributes = MatchupAttributes(
            activityId: id,
            leagueId: state.id,
            leagueName: state.name,
            week: week,
            teamId: me.id,
            myTeam: me.teamName,
            oppTeam: opp?.teamName ?? "Bye Week",
            myColor: me.color,
            oppColor: opp?.color ?? "8D99AE"
        )
        do {
            try LiveActivityService.shared.start(attributes: attributes, content: state.liveContent(teamId: me.id, week: week, athletes: athleteMap, projections: projCache[week]?.data))
            flash("Live Activity is on your Lock Screen")
            Haptics.success()
        } catch {
            errorMessage = "Couldn't start the Live Activity. Make sure Live Activities are enabled in Settings."
        }
    }

    func stopLiveActivity() {
        guard let state = league, let id = liveActivityId(for: state) else { return }
        Task { await LiveActivityService.shared.end(id, content: nil, immediately: true) }
    }

    private func syncLiveActivity(_ state: LeagueState) async {
        guard let id = liveActivityId(for: state) else { return }
        await LiveActivityService.shared.endStale(leagueId: state.id, keeping: id)
        guard LiveActivityService.shared.isRunning(id) else { return }
        let content = state.liveContent(teamId: state.me, week: state.displayWeek, athletes: athleteMap, projections: projCache[state.displayWeek]?.data)
        if content.status == "FINAL" {
            await LiveActivityService.shared.end(id, content: content, immediately: false)
        } else {
            await LiveActivityService.shared.update(id, content: content)
        }
    }

    // MARK: - Feedback

    func show(_ error: Error) {
        errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        Haptics.error()
    }

    func flash(_ message: String) {
        toastTask?.cancel()
        withAnimation(.spring) { toast = message }
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2.4))
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut) { self?.toast = nil }
        }
    }
}

enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
    static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
}
