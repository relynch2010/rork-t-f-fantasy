import SwiftUI

/// Every athlete ranked by season fantasy points. Order comes from the server so ties break the same for everyone.
struct RankingsView: View {
    @Environment(AppStore.self) private var store
    @State private var pos: PosFilter = .all
    @State private var gender: Gender?

    var body: some View {
        Group {
            if let league = store.league {
                let ranked = (league.rankings ?? []).compactMap { store.athlete($0) }
                    .filter { pos.matches($0) && (gender == nil || $0.gender == gender) }
                let rank = league.rankMap
                ScrollView {
                    LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                        Section {
                            if ranked.isEmpty {
                                EmptyStateView(icon: "list.number", title: "No athletes", message: "Try a different filter.")
                            }
                            ForEach(ranked) { a in
                                row(league, a, rank: rank[a.id] ?? 0)
                                RowDivider(inset: 64)
                            }
                        } header: {
                            VStack(spacing: 8) {
                                ChipRow {
                                    ForEach(PosFilter.allCases) { option in
                                        ChipButton(title: option.rawValue, isOn: pos == option) { pos = option }
                                    }
                                    ChipButton(title: "Boys", isOn: gender == .B) { gender = gender == .B ? nil : .B }
                                    ChipButton(title: "Girls", isOn: gender == .G) { gender = gender == .G ? nil : .G }
                                }
                                HStack {
                                    Text("Rank").frame(width: 40, alignment: .leading)
                                    Text("Player")
                                    Spacer()
                                    Text("Season")
                                }
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.muted)
                                .padding(.horizontal, 16)
                                .padding(.bottom, 6)
                            }
                            .padding(.top, 8)
                            .background(Theme.bg)
                        }
                    }
                    .padding(.bottom, 40)
                }
            }
        }
        .background(TrackBackground())
        .navigationTitle("Player Rankings")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func row(_ league: LeagueState, _ a: Athlete, rank: Int) -> some View {
        let owner = league.owner(of: a.id)
        return HStack(spacing: 10) {
            Text("\(rank)")
                .font(Theme.score(18))
                .foregroundStyle(rank <= 3 ? Theme.gold : Theme.muted)
                .frame(width: 34, alignment: .leading)
            AthleteBadge(athlete: a, size: 38)
            AthleteNameBlock(athlete: a, suffix: owner.map { $0.id == league.me ? "My Team" : $0.teamName } ?? (league.waivers[a.id] != nil ? "Waivers" : "FA"), compact: true)
            PointsButton(athleteId: a.id, value: league.seasonPoints(a.id), size: 18)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 4)
        .background(Theme.surface)
    }
}
