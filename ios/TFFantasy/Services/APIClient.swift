import Foundation

nonisolated struct UserProfile: Codable, Hashable, Sendable {
    let id: String
    var name: String
    var email: String?
}

/// Push categories the account has turned on. Off only silences the push; the Notification Center still gets it.
nonisolated struct NotificationPrefs: Codable, Hashable, Sendable {
    var player: Bool = true
    var trades: Bool = true
    var waivers: Bool = true
    var draft: Bool = true
    var live: Bool = true
    var league: Bool = true
}

nonisolated struct AuthResponse: Codable, Sendable {
    let token: String
    let user: UserProfile
    let prefs: NotificationPrefs?
}

nonisolated struct APIError: LocalizedError, Sendable {
    let message: String
    let status: Int
    /// Raw error body (used where the server sends structured details, e.g. account-deletion hand-offs).
    var body: Data? = nil

    var errorDescription: String? { message }
}

private nonisolated struct ErrorBody: Decodable { let error: String }
private nonisolated struct UnchangedBody: Decodable { let unchanged: Bool }
private nonisolated struct LeaguesBody: Decodable { let leagues: [LeagueSummary] }
nonisolated struct ResetResponse: Decodable, Sendable { let ok: Bool; let email: Bool? }
nonisolated struct RemoteConfig: Decodable, Sendable { let oneSignalAppId: String }

/// Thin client for the Fantasy T&F backend. Every signed-in request carries `Authorization: Bearer <session>`.
final class APIClient {
    static let base: String = {
        let raw = Config.EXPO_PUBLIC_RORK_FUNCTIONS_URL.trimmingCharacters(in: .whitespacesAndNewlines)
        let value = raw.isEmpty ? "https://trackdraft-backend.rork.app" : raw
        return value.hasSuffix("/") ? String(value.dropLast()) : value
    }()

    /// Set by the store; nil when signed out.
    var token: String?

    /// Called when the server rejects the session so the app can return to sign-in.
    var onUnauthorized: (() -> Void)?

    private var baseURL: String { Self.base }

    /// Team photo URL; `version` busts the cache when the photo changes.
    static func avatarURL(leagueId: String, teamId: String, version: Double) -> URL? {
        URL(string: "\(base)/leagues/\(leagueId)/avatar/\(teamId)?v=\(Int(version))")
    }

    /// Realtime channel: the server pushes a tiny "state changed" signal whenever the league updates.
    static func socketURL(leagueId: String, token: String) -> URL? {
        let ws = base.replacingOccurrences(of: "https://", with: "wss://").replacingOccurrences(of: "http://", with: "ws://")
        let t = token.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? token
        return URL(string: "\(ws)/leagues/\(leagueId)/live?token=\(t)")
    }

    private let decoder = JSONDecoder()

    private func send(_ path: String, method: String = "GET", body: Data? = nil, authed: Bool = true, timeout: TimeInterval = 20) async throws -> Data {
        guard let url = URL(string: baseURL + path) else { throw APIError(message: "Bad URL", status: 0) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = timeout
        if authed {
            guard let token else { throw APIError(message: "Sign in to continue.", status: 401) }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw APIError(message: "Can't reach Fantasy T&F. Check your connection.", status: 0)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? decoder.decode(ErrorBody.self, from: data))?.error ?? "Something went wrong (\(status))."
            if status == 401, authed { onUnauthorized?() }
            throw APIError(message: message, status: status, body: data)
        }
        return data
    }

    private func json(_ object: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: object)
    }

    private func decodeState(_ data: Data) throws -> LeagueState {
        do {
            return try decoder.decode(LeagueState.self, from: data)
        } catch {
            print("[API] decode failed: \(error)")
            throw APIError(message: "Couldn't read league data.", status: 0)
        }
    }

    // MARK: Accounts

    func signUp(email: String, password: String, name: String) async throws -> AuthResponse {
        try decoder.decode(AuthResponse.self, from: try await send("/auth/signup", method: "POST", body: try json(["email": email, "password": password, "name": name]), authed: false))
    }

    func signIn(email: String, password: String) async throws -> AuthResponse {
        try decoder.decode(AuthResponse.self, from: try await send("/auth/login", method: "POST", body: try json(["email": email, "password": password]), authed: false))
    }

    /// Owner-only: needs the current password. Returns a fresh session; older sessions stop working.
    func changePassword(current: String, password: String) async throws -> AuthResponse {
        try decoder.decode(AuthResponse.self, from: try await send("/me/password", method: "POST", body: try json(["current": current, "password": password])))
    }

    func requestReset(email: String) async throws -> ResetResponse {
        try decoder.decode(ResetResponse.self, from: try await send("/auth/reset-request", method: "POST", body: try json(["email": email]), authed: false))
    }

    func confirmReset(email: String, code: String, password: String) async throws -> AuthResponse {
        try decoder.decode(AuthResponse.self, from: try await send("/auth/reset-confirm", method: "POST", body: try json(["email": email, "code": code, "password": password]), authed: false))
    }

    func me() async throws -> AuthResponse {
        try decoder.decode(AuthResponse.self, from: try await send("/me"))
    }

    func updateMe(name: String?, prefs: NotificationPrefs?) async throws -> AuthResponse {
        var body: [String: Any] = [:]
        if let name { body["name"] = name }
        if let prefs {
            body["prefs"] = ["player": prefs.player, "trades": prefs.trades, "waivers": prefs.waivers, "draft": prefs.draft, "live": prefs.live, "league": prefs.league]
        }
        return try decoder.decode(AuthResponse.self, from: try await send("/me", method: "POST", body: try json(body)))
    }

    /// `handoffs`: leagueId → teamId of the member who takes over as commissioner.
    func deleteAccount(handoffs: [String: String] = [:]) async throws {
        _ = try await send("/me/delete", method: "POST", body: try json(["handoffs": handoffs]))
    }

    // MARK: Push

    func registerPush(_ body: [String: Any]) async throws {
        _ = try await send("/me/push/register", method: "POST", body: try json(body))
    }

    func pushStatus(subscriptionId: String?) async throws -> PushStatusBody {
        let q = (subscriptionId ?? "").addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        return try decoder.decode(PushStatusBody.self, from: try await send("/me/push/status?subscriptionId=\(q)"))
    }

    func pushTest(subscriptionId: String?) async throws -> PushTestResult {
        try decoder.decode(PushTestResult.self, from: try await send("/me/push/test", method: "POST", body: try json(["subscriptionId": subscriptionId ?? ""]), timeout: 45))
    }

    func config() async throws -> RemoteConfig {
        try decoder.decode(RemoteConfig.self, from: try await send("/config", authed: false))
    }

    // MARK: Leagues

    func myLeagues() async throws -> [LeagueSummary] {
        try decoder.decode(LeaguesBody.self, from: try await send("/leagues")).leagues
    }

    func createLeague(name: String, teamName: String, school: String, settings: [String: Any]) async throws -> LeagueState {
        try decodeState(try await send("/leagues", method: "POST", body: try json(["name": name, "teamName": teamName, "school": school, "settings": settings])))
    }

    /// Schools with players on file (for the create-league picker).
    func schools() async throws -> [SchoolOption] {
        try decoder.decode(SchoolsBody.self, from: try await send("/schools")).schools
    }

    func joinLeague(code: String, teamName: String) async throws -> LeagueState {
        try decodeState(try await send("/leagues/join", method: "POST", body: try json(["code": code, "teamName": teamName])))
    }

    /// Returns nil when the server reports the state hasn't changed since `since`.
    func state(leagueId: String, since: Int?) async throws -> LeagueState? {
        let data = try await send("/leagues/\(leagueId)?since=\(since ?? -1)")
        if let unchanged = try? decoder.decode(UnchangedBody.self, from: data), unchanged.unchanged { return nil }
        return try decodeState(data)
    }

    func action(leagueId: String, body: [String: Any]) async throws -> LeagueState {
        try decodeState(try await send("/leagues/\(leagueId)/action", method: "POST", body: try json(body)))
    }

    /// Every scoring line for one athlete, straight from the server scoring engine.
    func athleteLines(leagueId: String, athleteId: String) async throws -> [ScoreLine] {
        let id = athleteId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? athleteId
        return try decoder.decode(AthleteLinesBody.self, from: try await send("/leagues/\(leagueId)/athlete?athleteId=\(id)")).lines
    }

    func scoring(leagueId: String) async throws -> ScoringData {
        try decoder.decode(ScoringData.self, from: try await send("/leagues/\(leagueId)/scoring"))
    }

    /// Commissioner-only. The server rejects anyone else (403) and refuses if the photo changed since `expectAt`.
    func uploadAthletePhoto(leagueId: String, athleteId: String, base64: String?, expectAt: Double?) async throws -> LeagueState {
        var body: [String: Any] = ["athleteId": athleteId, "expectAt": expectAt.map { Int($0) } as Any? ?? NSNull()]
        if let base64 { body["image"] = base64 } else { body["remove"] = true }
        return try decodeState(try await send("/leagues/\(leagueId)/athlete-photo", method: "POST", body: try json(body)))
    }

    func uploadAvatar(leagueId: String, base64: String) async throws -> LeagueState {
        try decodeState(try await send("/leagues/\(leagueId)/avatar", method: "POST", body: try json(["image": base64])))
    }

    /// Fetches + parses a meet source server-side without saving anything.
    func meetTest(leagueId: String, body: [String: Any]) async throws -> MeetTestResult {
        try decoder.decode(MeetTestResult.self, from: try await send("/leagues/\(leagueId)/meet-test", method: "POST", body: try json(body), timeout: 60))
    }

    /// Meet Test Lab (Main League commissioner): the production pipeline on a past meet, isolated from every league.
    func meetLab(leagueId: String, body: [String: Any]) async throws -> MeetTestResult {
        try decoder.decode(MeetTestResult.self, from: try await send("/leagues/\(leagueId)/meet-lab", method: "POST", body: try json(body), timeout: 90))
    }

    /// Scoring lines for only the athletes rostered by the two teams in a matchup.
    func matchupLines(leagueId: String, week: Int, teamId: String) async throws -> MatchupLinesBody {
        let tid = teamId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? teamId
        return try decoder.decode(MatchupLinesBody.self, from: try await send("/leagues/\(leagueId)/matchup?week=\(week)&teamId=\(tid)"))
    }

    // MARK: Integrity tools (weekly proof, reconcile, health, notification log, previews)

    func breakdown<T: Decodable>(leagueId: String, week: Int, athleteId: String?, teamId: String?, as type: T.Type) async throws -> T {
        let a = (athleteId ?? "").addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        let t = (teamId ?? "").addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        return try decoder.decode(T.self, from: try await send("/leagues/\(leagueId)/breakdown?week=\(week)&athleteId=\(a)&teamId=\(t)"))
    }

    func tool<T: Decodable>(leagueId: String, body: [String: Any], as type: T.Type) async throws -> T {
        try decoder.decode(T.self, from: try await send("/leagues/\(leagueId)/tools", method: "POST", body: try json(body), timeout: 120))
    }

    // MARK: Projections

    func projections(leagueId: String, week: Int) async throws -> WeekProjections {
        try decoder.decode(WeekProjections.self, from: try await send("/leagues/\(leagueId)/projections?week=\(week)"))
    }

    func athleteProjection(leagueId: String, athleteId: String, week: Int) async throws -> AthleteProjectionBody {
        let id = athleteId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? athleteId
        return try decoder.decode(AthleteProjectionBody.self, from: try await send("/leagues/\(leagueId)/projections?week=\(week)&athleteId=\(id)"))
    }

    /// Waiver / free-agent rankings for a week (recommendations only; never touches claim order).
    func rankings(leagueId: String, week: Int) async throws -> WaiverRankingsBody {
        try decoder.decode(WaiverRankingsBody.self, from: try await send("/leagues/\(leagueId)/projections?week=\(week)&rankings=1", timeout: 60))
    }

    /// Plain-language reason behind one player's projection, built only from verified evidence.
    func explain(leagueId: String, athleteId: String, week: Int) async throws -> ExplainBody {
        let id = athleteId.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? athleteId
        return try decoder.decode(ExplainBody.self, from: try await send("/leagues/\(leagueId)/projections?week=\(week)&athleteId=\(id)&explain=1", timeout: 45))
    }

    // MARK: Mock drafts (separate from the real league)

    func mock(leagueId: String, mockId: String?) async throws -> MockBody {
        try decoder.decode(MockBody.self, from: try await send("/leagues/\(leagueId)/mock?mockId=\(mockId ?? "")"))
    }

    func mockOp(leagueId: String, body: [String: Any]) async throws -> MockBody {
        try decoder.decode(MockBody.self, from: try await send("/leagues/\(leagueId)/mock", method: "POST", body: try json(body)))
    }

    // MARK: Global setup (Main League). The server checks the Main League commissioner on every change.

    func globalLeagues() async throws -> GlobalLeaguesBody {
        try decoder.decode(GlobalLeaguesBody.self, from: try await send("/global/leagues"))
    }

    /// Platform-level actions (checked by the server against the platform commissioner).
    func globalAction(_ body: [String: Any]) async throws {
        _ = try await send("/global/action", method: "POST", body: try json(body))
    }

    func seasonArchive(leagueId: String, id: String) async throws -> SeasonArchive {
        let q = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? id
        return try decoder.decode(SeasonArchive.self, from: try await send("/leagues/\(leagueId)/archive?id=\(q)"))
    }

    // MARK: League management

    func deleteLeague(leagueId: String, confirmName: String) async throws {
        _ = try await send("/leagues/\(leagueId)/delete", method: "POST", body: try json(["confirmName": confirmName]))
    }

    func setHidden(leagueId: String, hidden: Bool) async throws {
        _ = try await send("/leagues/\(leagueId)/hide", method: "POST", body: try json(["hidden": hidden]))
    }

    func coPreview(code: String) async throws -> CoInvitePreview {
        try decoder.decode(CoInvitePreview.self, from: try await send("/leagues/co/preview", method: "POST", body: try json(["code": code])))
    }

    func coAccept(code: String) async throws -> CoInvitePreview {
        try decoder.decode(CoInvitePreview.self, from: try await send("/leagues/co/accept", method: "POST", body: try json(["code": code])))
    }

    func coDecline(code: String) async throws {
        _ = try await send("/leagues/co/decline", method: "POST", body: try json(["code": code]))
    }

    /// Runs a result through the scoring engine without saving it.
    func preview(leagueId: String, body: [String: Any]) async throws -> ResultPreview {
        try decoder.decode(ResultPreview.self, from: try await send("/leagues/\(leagueId)/preview", method: "POST", body: try json(body)))
    }
}
