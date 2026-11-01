import SwiftUI

enum LeagueTab: Hashable {
    case team, matchup, players, league
}

/// Pushable destinations shared by every tab's navigation stack.
enum LeagueRoute: Hashable {
    case team(String)
    case matchup(String, Int)
    case scoreboard(Int)
    case draft
    case standings
    case transactions
    case trades
    case playoffs
    case settings
    case editSettings
    case commish
    case enterResult(ResultRecord?)
    case results
    case standards
    case performanceTables
    case schoolRecord
    case fumble
    case athletes
    case manageTeams
    case meetCenter
    case meet(String)
    case meetEditor(String?)
    case unmatched
    case adpReview
    case audit
    case rankings
    case notificationSettings
    case mockDrafts
    case deleteLeague
    case globalSettings
    case waivers
    case meetLab
    case integrity
    case scoringRules
    case pushDiagnostics
    case scoringLab
    case schedule
    case adminPanel
    case adminScoring(AdminAccess)
}

struct LeagueRootView: View {
    @Environment(AppStore.self) private var store
    @State private var tab: LeagueTab = .team

    var body: some View {
        @Bindable var store = store
        Group {
            if let league = store.league {
                TabView(selection: $tab) {
                    Tab("My Team", systemImage: "person.crop.square.fill", value: LeagueTab.team) {
                        LeagueStack(tab: .team) { TeamView(teamId: nil) }
                    }
                    Tab("Matchup", systemImage: "flag.2.crossed.fill", value: LeagueTab.matchup) {
                        LeagueStack(tab: .matchup) { MatchupView(teamId: nil, initialWeek: nil) }
                    }
                    Tab("Players", systemImage: "figure.run", value: LeagueTab.players) {
                        LeagueStack(tab: .players) { PlayersView() }
                    }
                    Tab("League", systemImage: "trophy.fill", value: LeagueTab.league) {
                        LeagueStack(tab: .league) { LeagueHubView() }
                    }
                    .badge(league.tradeBadgeCount)
                }
                .tint(Theme.green)
                .onChange(of: store.requestedTab) { _, next in
                    guard let next else { return }
                    tab = next
                    store.requestedTab = nil
                }
                .task(id: "\(league.id)|\(store.pendingLink?.type ?? "")|\(store.pendingLink?.id ?? "")") {
                    store.consumePendingLink()
                }
                .fullScreenCover(isPresented: $store.showDraftRoom) {
                    DraftRoomView()
                        .leagueSheets(active: true)
                }
                .leagueSheets(active: !store.showDraftRoom)
            } else {
                ZStack {
                    TrackBackground()
                    VStack(spacing: 16) {
                        ProgressView().controlSize(.large).tint(Theme.green)
                        Text("Loading league…")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.muted)
                        Button("Back to leagues") { store.closeLeague() }
                            .font(.subheadline)
                            .padding(.top, 20)
                    }
                }
            }
        }
    }
}

/// NavigationStack wired with every league destination.
struct LeagueStack<Root: View>: View {
    let tab: LeagueTab
    @ViewBuilder let root: Root

    @Environment(AppStore.self) private var store
    @State private var path: [LeagueRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            root
                .navigationDestination(for: LeagueRoute.self) { route in
                    destination(route)
                }
        }
        .onAppear(perform: consumeDeepRoute)
        .onChange(of: store.deepRoute) { _, _ in consumeDeepRoute() }
    }

    private func consumeDeepRoute() {
        guard let deep = store.deepRoute, deep.tab == tab else { return }
        store.deepRoute = nil
        path = [deep.route]
    }

    @ViewBuilder
    private func destination(_ route: LeagueRoute) -> some View {
        switch route {
        case .team(let id): TeamView(teamId: id)
        case .matchup(let id, let week): MatchupView(teamId: id, initialWeek: week)
        case .scoreboard(let week): ScoreboardView(initialWeek: week)
        case .draft: DraftLobbyView()
        case .standings: StandingsView()
        case .transactions: TransactionsView()
        case .trades: TradesView()
        case .playoffs: BracketView()
        case .settings: SettingsView()
        case .editSettings: EditSettingsView()
        case .commish: CommissionerView()
        case .enterResult(let existing): ResultEntryView(existing: existing)
        case .results: ResultsLogView()
        case .standards: StandardsView()
        case .performanceTables: PerformanceTablesView()
        case .schoolRecord: SchoolRecordForm()
        case .fumble: FumbleForm()
        case .athletes: AthleteEditorView()
        case .manageTeams: ManageTeamsView()
        case .meetCenter: MeetCenterView()
        case .meet(let id): MeetDetailView(meetId: id)
        case .meetEditor(let id): MeetEditorView(meetId: id)
        case .unmatched: UnmatchedResultsView()
        case .adpReview: AdpReviewView()
        case .audit: AuditLogView()
        case .rankings: RankingsView()
        case .notificationSettings: NotificationSettingsView()
        case .mockDrafts: MockDraftListView()
        case .deleteLeague: DeleteLeagueView()
        case .globalSettings: GlobalSettingsView()
        case .waivers: WaiversView()
        case .meetLab: MeetLabView()
        case .integrity: IntegrityView()
        case .scoringRules: ScoringRulesEditorView()
        case .pushDiagnostics: PushDiagnosticsView()
        case .scoringLab: ScoringLabView()
        case .schedule: ScheduleView()
        case .adminPanel: AdminPanelView()
        case .adminScoring(let access): ScoringRulesEditorView(admin: access)
        }
    }
}

/// Presents store-driven sheets. Only one host is active at a time (root vs. draft room).
struct LeagueSheetHost: ViewModifier {
    @Environment(AppStore.self) private var store
    let active: Bool

    func body(content: Content) -> some View {
        content
            .sheet(item: Binding(
                get: { active ? store.sheet : nil },
                set: { if active { store.sheet = $0 } }
            )) { sheet in
                Group {
                    switch sheet {
                    case .player(let id): PlayerCardView(athleteId: id)
                    case .breakdown(let id, let week): BreakdownView(athleteId: id, week: week)
                    case .weekProof(let id, let week): WeekBreakdownView(athleteId: id, week: week)
                    case .add(let id): AddDropSheet(athleteId: id)
                    case .trade(let to, let get, let counter): TradeSheet(toId: to, initialGet: get, counterOf: counter)
                    case .notifications: NotificationsView()
                    case .crop(let data): PhotoCropView(data: data)
                    }
                }
                .environment(store)
                .preferredColorScheme(.dark)
            }
            .overlay(alignment: .top) {
                if active, let toast = store.toast {
                    ToastView(message: toast)
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
    }
}

extension View {
    func leagueSheets(active: Bool) -> some View { modifier(LeagueSheetHost(active: active)) }
}
