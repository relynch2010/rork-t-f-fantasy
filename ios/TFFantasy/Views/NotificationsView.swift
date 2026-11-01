import SwiftUI
import UserNotifications

/// Server-backed Notification Center: unread dots, mark all read (synced across devices), tap to open.
struct NotificationsView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var status: UNAuthorizationStatus = .notDetermined
    @State private var filter: String = "all"

    private static let filters: [(String, String)] = [
        ("all", "All"), ("player", "Players"), ("live", "Scores"), ("trades", "Trades"), ("waivers", "Waivers"), ("draft", "Draft"), ("league", "League"),
    ]

    var body: some View {
        NavigationStack {
            let all = Array((store.league?.notifications ?? []).reversed())
            let notes = filter == "all" ? all : all.filter { ($0.category ?? "league") == filter }
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if status != .authorized && status != .provisional && status != .ephemeral {
                        pushOffCard
                    }
                    ChipRow {
                        ForEach(Self.filters, id: \.0) { f in
                            ChipButton(title: f.1, isOn: filter == f.0) { filter = f.0 }
                        }
                    }
                    .padding(.horizontal, -16)

                    if notes.isEmpty {
                        EmptyStateView(icon: "bell", title: "All quiet", message: "Player updates, trade offers, waiver results and scores will show up here.")
                    } else {
                        VStack(spacing: 0) {
                            ForEach(notes) { note in
                                Button { open(note) } label: { row(note) }
                                    .buttonStyle(.plain)
                                if note.id != notes.last?.id { Divider().overlay(Theme.line) }
                            }
                        }
                        .card(padding: 14)
                    }
                }
                .padding()
            }
            .background(Theme.bg)
            .refreshable { await store.fetchLeague(force: true) }
            .navigationTitle("Notifications")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Mark all read") { Task { await store.markAllRead() } }
                        .disabled(store.unreadCount == 0)
                }
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task { status = await PushService.shared.permissionStatus() }
        }
    }

    private var pushOffCard: some View {
        HStack(spacing: 12) {
            Image(systemName: "bell.slash.fill").foregroundStyle(Theme.gold).font(.title3)
            VStack(alignment: .leading, spacing: 2) {
                Text("Push is off").font(.subheadline.weight(.semibold))
                Text("Turn it on so you never miss your pick, a trade offer or a result.")
                    .font(.caption).foregroundStyle(Theme.muted)
            }
            Spacer()
            Button("Enable") {
                Task {
                    _ = await PushService.shared.requestPermission()
                    status = await PushService.shared.permissionStatus()
                }
            }
            .font(.caption.weight(.heavy))
            .buttonStyle(.borderedProminent)
            .tint(Theme.green)
            .foregroundStyle(.black)
        }
        .card(padding: 14)
    }

    private func row(_ note: LeagueNote) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: Self.icon(note))
                .font(.subheadline.weight(.bold))
                .foregroundStyle(Self.tint(note))
                .frame(width: 34, height: 34)
                .background(Self.tint(note).opacity(0.14), in: .circle)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(note.title)
                        .font(.subheadline.weight(note.isRead ? .semibold : .heavy))
                        .foregroundStyle(note.isRead ? .white.opacity(0.75) : .white)
                    Spacer(minLength: 6)
                    if !note.isRead {
                        Circle().fill(Theme.gold).frame(width: 8, height: 8)
                            .accessibilityLabel("Unread")
                    }
                }
                Text(note.body).font(.subheadline).foregroundStyle(.white.opacity(note.isRead ? 0.6 : 0.85))
                    .multilineTextAlignment(.leading)
                Text(Fmt.ago(note.at)).font(.caption2).foregroundStyle(Theme.faint)
            }
        }
        .padding(.vertical, 10)
        .contentShape(.rect)
    }

    private func open(_ note: LeagueNote) {
        Haptics.tap()
        if !note.isRead { Task { await store.markRead([note.id]) } }
        guard let link = note.link, link.type != "none", let league = store.league else { return }
        if link.type == "player" {
            store.open(link: link, in: league)
            return
        }
        dismiss()
        Task {
            try? await Task.sleep(for: .milliseconds(350))
            store.open(link: link, in: league)
        }
    }

    static func icon(_ note: LeagueNote) -> String {
        switch note.category ?? note.kind {
        case "draft": return "timer"
        case "trades", "trade": return "arrow.left.arrow.right"
        case "waivers", "waiver": return "tray.and.arrow.down.fill"
        case "live", "score": return "chart.bar.fill"
        case "player": return "person.fill"
        case "result": return "flag.checkered"
        default: return note.kind == "join" ? "person.badge.plus" : "bell.fill"
        }
    }

    static func tint(_ note: LeagueNote) -> Color {
        switch note.category ?? note.kind {
        case "trades": return Theme.sprint
        case "waivers": return Theme.gold
        case "player": return Theme.distance
        case "draft": return Theme.field
        default: return Theme.green
        }
    }
}

/// Push preferences, saved to the account. Off only silences the push; the Notification Center keeps everything.
struct NotificationSettingsView: View {
    @Environment(AppStore.self) private var store
    @State private var status: UNAuthorizationStatus = .notDetermined

    var body: some View {
        List {
            if status == .denied {
                Section {
                    Button("Open iPhone Settings to allow notifications") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                    }
                    .foregroundStyle(Theme.gold)
                    .listRowBackground(Theme.surface)
                }
            } else if status == .notDetermined {
                Section {
                    Button("Turn on notifications") {
                        Task {
                            _ = await PushService.shared.requestPermission()
                            status = await PushService.shared.permissionStatus()
                        }
                    }
                    .foregroundStyle(Theme.green)
                    .listRowBackground(Theme.surface)
                }
            }
            Section {
                toggle("Player Updates", "Status changes for your players", \.player)
                toggle("Live Scoring", "Results for your starters, meet start and final, weekly results", \.live)
                toggle("Trades", "Offers, counters, accepted, declined, completed", \.trades)
                toggle("Waivers", "Claims won or lost, adds", \.waivers)
                toggle("Draft", "Draft time, your pick, auto-picks", \.draft)
                toggle("League Activity", "New managers, commissioner changes, playoffs", \.league)
            } header: {
                Text("Push notifications")
            } footer: {
                Text("Saved to your account, so they apply on every phone. Turning a type off only stops the push. It still shows in Notifications.")
            }
            Section {
                NavigationLink(value: LeagueRoute.pushDiagnostics) {
                    Label("Test push on this iPhone", systemImage: "paperplane.fill")
                }
                .listRowBackground(Theme.surface)
            } footer: {
                Text("Sends a real notification from the server and shows exactly where it stopped if it doesn't arrive.")
            }
        }
        .screenBackground()
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task { status = await PushService.shared.permissionStatus() }
    }

    private func toggle(_ title: String, _ detail: String, _ key: WritableKeyPath<NotificationPrefs, Bool>) -> some View {
        Toggle(isOn: Binding(
            get: { store.prefs[keyPath: key] },
            set: { value in
                var next = store.prefs
                next[keyPath: key] = value
                Task { await store.updatePrefs(next) }
            }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(detail).font(.caption).foregroundStyle(Theme.muted)
            }
        }
        .tint(Theme.green)
        .listRowBackground(Theme.surface)
    }
}
