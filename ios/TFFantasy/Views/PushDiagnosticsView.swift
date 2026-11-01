import SwiftUI
import UserNotifications

/// End-to-end push check for the signed-in phone: iOS permission → APNs token → OneSignal subscription →
/// account link → server send → APNs outcome. "Send test push" delivers a real push from the production backend.
struct PushDiagnosticsView: View {
    @Environment(AppStore.self) private var store
    @State private var local: LocalPushState?
    @State private var server: PushStatusBody?
    @State private var test: PushTestResult?
    @State private var isLoading: Bool = false
    @State private var isSending: Bool = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                hero
                sendButton
                if let test { testCard(test) }
                if let local { phoneCard(local) }
                if let server { serverCard(server) }
                Text("Push only works on a real iPhone running the TestFlight or App Store build. Simulators never get remote pushes.")
                    .font(.caption).foregroundStyle(Theme.faint)
            }
            .padding()
        }
        .screenBackground()
        .navigationTitle("Push Diagnostics")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { Task { await load() } } label: { Image(systemName: "arrow.clockwise") }
                    .disabled(isLoading)
                    .accessibilityLabel("Refresh")
            }
        }
    }

    // MARK: Header

    private var verdict: (String, String, Color) {
        if let test {
            switch test.status {
            case "delivered": return ("checkmark.seal.fill", "APNs accepted the test push", Theme.green)
            case "sent": return ("paperplane.fill", "Sent, waiting on APNs", Theme.gold)
            default: return ("xmark.octagon.fill", "Test push did not reach this phone", Theme.red)
            }
        }
        if let problem = server?.problem { return ("exclamationmark.triangle.fill", problem, Theme.gold) }
        if server != nil { return ("checkmark.circle.fill", "This phone is registered for push", Theme.green) }
        return ("bell.badge", "Checking this phone…", Theme.muted)
    }

    private var hero: some View {
        let v = verdict
        return HStack(alignment: .top, spacing: 12) {
            Image(systemName: v.0)
                .font(.title2)
                .foregroundStyle(v.2)
                .symbolEffect(.bounce, value: test?.at)
            Text(v.1).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
        }
        .card()
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(v.2.opacity(0.4)))
    }

    private var sendButton: some View {
        Button {
            Task { await send() }
        } label: {
            HStack {
                if isSending { ProgressView().tint(.black) } else { Image(systemName: "paperplane.fill") }
                Text(isSending ? "Sending and waiting for APNs…" : "Send test push to this iPhone")
            }
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 52)
            .foregroundStyle(.black)
            .background(Theme.green, in: .rect(cornerRadius: 14))
        }
        .buttonStyle(PressableStyle())
        .disabled(isSending)
        .accessibilityIdentifier("sendTestPush")
    }

    // MARK: Cards

    private func testCard(_ t: PushTestResult) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            label("DELIVERY REPORT", "list.bullet.clipboard")
            ForEach(Array(t.steps.enumerated()), id: \.offset) { _, s in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: s.ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundStyle(s.ok ? Theme.green : Theme.red)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.step).font(.subheadline.weight(.semibold))
                        Text(s.detail).font(.caption).foregroundStyle(Theme.muted).textSelection(.enabled)
                    }
                }
            }
            if let st = t.stats {
                HStack(spacing: 8) {
                    stat("Accepted", st.successful, Theme.green)
                    stat("Invalid", st.failed, Theme.gold)
                    stat("Errored", st.errored, Theme.red)
                    stat("Received", st.received ?? 0, Theme.green)
                }
            }
            if let id = t.notificationId {
                Text("Notification \(id)").font(.caption2.monospaced()).foregroundStyle(Theme.faint).textSelection(.enabled)
            }
            if t.status == "delivered" {
                Text("If it didn't appear: check Focus / Do Not Disturb, and that T&F Fantasy notifications are on in iPhone Settings. Pushes show as banners even while the app is open.")
                    .font(.caption).foregroundStyle(Theme.muted)
            }
        }
        .card()
        .transition(.move(edge: .top).combined(with: .opacity))
    }

    private func phoneCard(_ s: LocalPushState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            label("THIS IPHONE", "iphone")
            row("iOS permission", s.permission, ok: s.permission == "allowed" || s.permission == "provisional")
            row("Push SDK started", s.initialized ? "Yes" : "No (server app id missing)", ok: s.initialized)
            row("APNs device token", s.token == nil ? "Not received yet" : s.tokenTail, ok: s.token != nil)
            row("Subscription", s.subscriptionId.map { String($0.prefix(8)) + "…" } ?? "None", ok: s.subscriptionId != nil)
            row("Opted in", s.optedIn ? "Yes" : "No", ok: s.optedIn)
            row("Linked account", s.externalId == store.user?.id ? "You" : (s.externalId == nil ? "Not linked" : "Different account"), ok: s.externalId == store.user?.id)
            row("Build APNs environment", PushService.apnsEnvironment, ok: true)
            if s.permission == "denied" {
                Button("Open iPhone Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.gold)
            } else if s.permission == "not asked" {
                Button("Allow notifications") {
                    Task {
                        _ = await PushService.shared.requestPermission()
                        await load()
                    }
                }
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.green)
            }
        }
        .card()
    }

    private func serverCard(_ s: PushStatusBody) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            label("PRODUCTION BACKEND", "server.rack")
            row("Push keys on server", s.configured ? "Configured" : "Missing", ok: s.configured)
            if let ok = s.keyValid { row("OneSignal REST key", ok ? "Accepted" : "Rejected", ok: ok) }
            if let app = s.app, app.readable {
                row("APNs auth", app.hasP8 == true ? "Token key \(app.keyId ?? "")" : "No .p8 key", ok: app.hasP8 == true)
                row("APNs environment", app.apnsEnv ?? "?", ok: app.apnsEnv == "production")
                row("Team ID", app.teamId ?? "?", ok: app.teamId != nil)
                row("APNs bundle ID", app.bundleId ?? "?", ok: app.bundleMatches != false)
                if app.bundleMatches == false {
                    Text("This app is \(s.bundleId ?? "fantasytrackapp.rork"). Apple rejects every push sent with a different bundle ID.")
                        .font(.caption).foregroundStyle(Theme.red)
                }
            }
            if let u = s.user {
                row("Account in OneSignal", u.found ? "\(u.subscriptions.count) device\(u.subscriptions.count == 1 ? "" : "s")" : "Not linked", ok: u.found)
                ForEach(u.subscriptions) { sub in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(sub.deviceModel.isEmpty ? "Device" : sub.deviceModel) · iOS \(sub.deviceOs) · \(sub.environment)")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(sub.subscribed ? Theme.green : Theme.gold)
                        Text(sub.stateText).font(.caption2).foregroundStyle(Theme.muted)
                    }
                    .padding(.leading, 4)
                }
            }
        }
        .card()
    }

    // MARK: Pieces

    private func label(_ text: String, _ icon: String) -> some View {
        Label(text, systemImage: icon).font(.system(size: 11, weight: .heavy)).foregroundStyle(Theme.muted)
    }

    private func row(_ title: String, _ value: String, ok: Bool) -> some View {
        HStack(spacing: 8) {
            Circle().fill(ok ? Theme.green : Theme.red).frame(width: 7, height: 7)
            Text(title).font(.subheadline)
            Spacer(minLength: 8)
            Text(value).font(.caption.monospaced()).foregroundStyle(Theme.muted).lineLimit(1).truncationMode(.middle)
        }
        .accessibilityElement(children: .combine)
    }

    private func stat(_ title: String, _ value: Int, _ tint: Color) -> some View {
        VStack(spacing: 2) {
            Text("\(value)").font(.title3.weight(.heavy)).foregroundStyle(tint).contentTransition(.numericText())
            Text(title).font(.caption2).foregroundStyle(Theme.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(Theme.surface2, in: .rect(cornerRadius: 10))
    }

    // MARK: Actions

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        await PushService.shared.optInIfAllowed()
        await store.syncPushDevice(force: true)
        local = await PushService.shared.localState()
        server = await store.pushStatus()
    }

    private func send() async {
        isSending = true
        defer { isSending = false }
        Haptics.tap()
        let result = await store.sendTestPush()
        withAnimation(.snappy) { test = result }
        if result?.status == "delivered" { Haptics.success() } else { Haptics.warning() }
        local = await PushService.shared.localState()
        server = await store.pushStatus()
    }
}
