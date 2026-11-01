import SwiftUI

/// Yahoo "League" tab: league header, shortcut chips, draft card, standings.
struct LeagueHubView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        Group {
            if let league = store.league {
                ScrollView {
                    VStack(spacing: 0) {
                        header(league)
                        chips(league)
                        if league.phaseKind == .predraft || league.phaseKind == .drafting {
                            DraftCountdownCard(league: league)
                                .padding(.horizontal, 16)
                                .padding(.top, 16)
                        }
                        if league.phaseKind == .complete, let champ = league.team(league.bracket?.championId ?? league.standings.first) {
                            championCard(champ, season: league.season)
                                .padding(.horizontal, 16)
                                .padding(.top, 16)
                        }
                        standings(league)
                    }
                    .padding(.bottom, 40)
                }
            }
        }
        .background(TrackBackground())
        .leagueChrome()
    }

    private func header(_ league: LeagueState) -> some View {
        HStack(spacing: 14) {
            Image(systemName: "trophy.fill")
                .font(.system(size: 24))
                .foregroundStyle(.black)
                .frame(width: 58, height: 58)
                .background(Circle().fill(LinearGradient(colors: [Theme.greenBright, Theme.green], startPoint: .top, endPoint: .bottom)))
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(league.name)
                        .font(.system(size: 24, weight: .black).width(.condensed).italic())
                        .lineLimit(1)
                    NavigationLink(value: LeagueRoute.settings) {
                        Image(systemName: "gearshape.fill").font(.system(size: 15)).foregroundStyle(Theme.muted)
                    }
                    .accessibilityLabel("League settings")
                }
                HStack(spacing: 6) {
                    Text("\(String(league.season)) SEASON")
                        .font(.system(size: 11, weight: .heavy))
                        .tracking(0.8)
                        .foregroundStyle(.black)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Theme.gold, in: .capsule)
                    ShareLink(item: "Join my Fantasy T&F league \"\(league.name)\" with code \(league.code)") {
                        HStack(spacing: 4) {
                            Text("CODE \(league.code)")
                            Image(systemName: "square.and.arrow.up")
                        }
                        .font(.system(size: 11, weight: .heavy).monospaced())
                        .foregroundStyle(Theme.muted)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 16)
    }

    private func chips(_ league: LeagueState) -> some View {
        VStack(spacing: 10) {
            ChipRow {
                link("Draft", "timer", .draft)
                link("Matchups", "square.grid.2x2", .scoreboard(league.displayWeek))
                link("Transactions", "arrow.left.arrow.right", .transactions)
                link("Trades", "arrow.triangle.swap", .trades, badge: league.tradeBadgeCount)
            }
            ChipRow {
                link("Playoffs", "trophy", .playoffs)
                link("Standings", "list.number", .standings)
                link("Mock Drafts", "timer.circle", .mockDrafts)
                link("Settings", "gearshape", .settings)
                if league.isCommissioner {
                    link("Commish Tools", "wrench.and.screwdriver.fill", .commish, highlight: true)
                }
            }
        }
    }

    private func link(_ title: String, _ icon: String, _ route: LeagueRoute, badge: Int = 0, highlight: Bool = false) -> some View {
        NavigationLink(value: route) {
            ChipLabel(title: title, systemImage: icon, isOn: highlight, badge: badge)
        }
        .buttonStyle(.plain)
    }

    private func championCard(_ team: Team, season: Int) -> some View {
        HStack(spacing: 14) {
            Image(systemName: "trophy.fill").font(.system(size: 30)).foregroundStyle(Theme.gold)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(String(season)) CHAMPION").font(.system(size: 11, weight: .heavy)).tracking(1).foregroundStyle(Theme.gold)
                Text(team.teamName).font(Theme.display(24))
                Text("\(team.record) • \(team.ownerName)").font(.caption).foregroundStyle(Theme.muted)
            }
            Spacer()
            TeamLogo(team: team, size: 48)
        }
        .card()
    }

    private func standings(_ league: LeagueState) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text("Standings").font(.system(size: 22, weight: .bold))
                Spacer()
                NavigationLink(value: LeagueRoute.standings) {
                    HStack(spacing: 4) {
                        Text("View details")
                        Image(systemName: "chevron.right").font(.caption.weight(.bold))
                    }
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 22)
            .padding(.bottom, 10)
            StandingsTable(league: league, detailed: false)
        }
    }
}

/// Standings table shared by the League tab (compact) and the detail page.
struct StandingsTable: View {
    let league: LeagueState
    let detailed: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                Text("Rank").frame(width: 44, alignment: .leading)
                Text("Team").frame(maxWidth: .infinity, alignment: .leading)
                Text("W-L-T").frame(width: 58, alignment: .trailing)
                Text("PF").frame(width: 62, alignment: .trailing)
                if detailed {
                    Text("PA").frame(width: 58, alignment: .trailing)
                    Text("Strk").frame(width: 40, alignment: .trailing)
                    Text("WP").frame(width: 32, alignment: .trailing)
                }
            }
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Theme.muted)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            let teams = league.standingsTeams
            ForEach(Array(teams.enumerated()), id: \.element.id) { index, team in
                NavigationLink(value: LeagueRoute.team(team.id)) {
                    row(index + 1, team)
                }
                .buttonStyle(.plain)
                if index + 1 == league.playoffCutoff, index + 1 < teams.count {
                    HStack(spacing: 8) {
                        Rectangle().fill(Theme.green.opacity(0.6)).frame(height: 1)
                        Text("PLAYOFF LINE").font(.system(size: 9, weight: .heavy)).tracking(1).foregroundStyle(Theme.green)
                        Rectangle().fill(Theme.green.opacity(0.6)).frame(height: 1)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 4)
                } else if index < teams.count - 1 {
                    RowDivider(inset: 0)
                }
            }
        }
        .background(Theme.surface)
    }

    private func row(_ rank: Int, _ team: Team) -> some View {
        let mine = team.id == league.me
        return HStack(spacing: 0) {
            Text("\(rank)")
                .font(.system(size: 15, weight: .semibold).monospacedDigit())
                .frame(width: 44, alignment: .leading)
            HStack(spacing: 8) {
                TeamLogo(team: team, size: 28)
                VStack(alignment: .leading, spacing: 1) {
                    Text(team.teamName).font(.system(size: 15, weight: mine ? .bold : .medium)).lineLimit(1)
                    if detailed { Text(team.ownerName).font(.caption2).foregroundStyle(Theme.muted).lineLimit(1) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(team.record).frame(width: 58, alignment: .trailing)
            Text(Fmt.pts(team.pointsFor)).frame(width: 62, alignment: .trailing)
            if detailed {
                Text(Fmt.pts(team.pointsAgainst)).frame(width: 58, alignment: .trailing)
                Text(team.streak.isEmpty ? "–" : team.streak)
                    .foregroundStyle(team.streak.hasPrefix("W") ? Theme.green : team.streak.hasPrefix("L") ? Theme.red : Theme.muted)
                    .frame(width: 40, alignment: .trailing)
                Text("\(team.waiverPriority)").frame(width: 32, alignment: .trailing)
            }
        }
        .font(.system(size: detailed ? 13 : 15).monospacedDigit())
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .frame(minHeight: 52)
        .background(mine ? Color.white.opacity(0.06) : .clear)
        .contentShape(.rect)
    }
}

struct StandingsView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        ScrollView {
            if let league = store.league {
                VStack(alignment: .leading, spacing: 12) {
                    StandingsTable(league: league, detailed: true)
                    Text("Tiebreaker: \(league.settings.tiebreaker == "h2h" ? "head-to-head, then points for" : "points for"). WP = waiver priority. Top \(league.playoffCutoff) make the playoffs.")
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                        .padding(.horizontal, 16)
                }
                .padding(.vertical, 12)
            }
        }
        .background(TrackBackground())
        .navigationTitle("Standings")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Pre-draft countdown and entry to the draft room.
struct DraftCountdownCard: View {
    let league: LeagueState
    @Environment(AppStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(league.phaseKind == .drafting ? "DRAFT IS LIVE" : "LIVE DRAFT")
                    .font(.system(size: 12, weight: .heavy))
                    .tracking(1.2)
                    .foregroundStyle(league.phaseKind == .drafting ? Theme.green : Theme.gold)
                Spacer()
                Text("\(league.teams.count)/\(league.settings.maxTeams) teams")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.muted)
            }
            if league.phaseKind == .drafting {
                Text("Pick \(min(league.draft.picks.count + 1, league.totalPicks)) of \(league.totalPicks)")
                    .font(Theme.display(30))
                if league.teamOnClock == league.me {
                    Text("You're on the clock!").font(.headline).foregroundStyle(Theme.green)
                } else if let t = league.team(league.teamOnClock) {
                    Text("\(t.teamName) is on the clock").font(.subheadline).foregroundStyle(Theme.muted)
                }
            } else if let at = league.settings.draftAt {
                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    let remaining = Int((at - store.serverNowMs) / 1000)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(remaining > 0 ? countdown(remaining) : "Starting…")
                            .font(Theme.score(36))
                            .contentTransition(.numericText())
                        Text(Fmt.dateTime(at)).font(.subheadline).foregroundStyle(Theme.muted)
                    }
                }
            } else {
                Text("Draft time not set").font(Theme.display(26))
                Text(league.isCommissioner ? "Set a date in Settings, or start the draft whenever everyone's ready." : "The commissioner will start the draft.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
            }
            PrimaryButton(title: "Enter Draft Room", systemImage: "door.left.hand.open") {
                store.showDraftRoom = true
            }
        }
        .card()
    }

    private func countdown(_ s: Int) -> String {
        let d = s / 86_400, h = (s % 86_400) / 3600, m = (s % 3600) / 60, sec = s % 60
        if d > 0 { return "\(d)d \(h)h \(m)m" }
        return String(format: "%02d:%02d:%02d", h, m, sec)
    }
}
