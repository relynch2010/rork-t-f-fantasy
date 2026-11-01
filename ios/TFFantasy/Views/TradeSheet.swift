import SwiftUI

/// Yahoo-style propose trade flow: pick team → pick players on both sides → note → review → send.
struct TradeSheet: View {
    let toId: String?
    let initialGet: [String]
    let counterOf: String?

    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var partnerId: String?
    @State private var give: Set<String> = []
    @State private var get: Set<String> = []
    @State private var message: String = ""
    @State private var reviewing: Bool = false

    var body: some View {
        NavigationStack {
            Group {
                if let league = store.league, let me = league.myTeam {
                    if let partner = league.team(partnerId) {
                        if reviewing {
                            review(league, me, partner)
                        } else {
                            pickPlayers(league, me, partner)
                        }
                    } else {
                        pickTeam(league)
                    }
                }
            }
            .background(Theme.bg)
            .navigationTitle(counterOf == nil ? "Propose Trade" : "Counter Offer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if reviewing {
                        Button("Back") { withAnimation(.snappy) { reviewing = false } }
                    } else if partnerId != nil, toId == nil {
                        Button("Teams") { withAnimation(.snappy) { partnerId = nil } }
                    } else {
                        Button("Cancel") { dismiss() }
                    }
                }
            }
        }
        .presentationDetents([.large])
        .presentationBackground(Theme.bg)
        .onAppear {
            partnerId = toId
            get = Set(initialGet)
            if let counterOf, let orig = store.league?.trades.first(where: { $0.id == counterOf }) {
                give = Set(orig.get)
                get = Set(orig.give)
            }
        }
    }

    private func pickTeam(_ league: LeagueState) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Trade with").font(.system(size: 20, weight: .bold)).padding(16)
                ForEach(league.standingsTeams.filter { $0.id != league.me }) { t in
                    Button {
                        Haptics.tap()
                        withAnimation(.snappy) {
                            partnerId = t.id
                            get = []
                        }
                    } label: {
                        HStack(spacing: 12) {
                            TeamLogo(team: t, size: 40)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(t.teamName).font(.system(size: 16, weight: .semibold))
                                Text("\(t.record) • \(t.ownerName)").font(.caption).foregroundStyle(Theme.muted)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(Theme.faint)
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 64)
                        .background(Theme.surface)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    RowDivider(inset: 68)
                }
            }
        }
    }

    private func pickPlayers(_ league: LeagueState, _ me: Team, _ partner: Team) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                rosterPicker(title: "You get from \(partner.teamName)", team: partner, league: league, selection: $get, tint: Theme.green)
                rosterPicker(title: "You send", team: me, league: league, selection: $give, tint: Theme.gold)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Note (optional)").font(.subheadline.weight(.semibold))
                    TextField("Add a message…", text: $message, axis: .vertical)
                        .lineLimit(2...4)
                        .padding(12)
                        .background(Theme.surface, in: .rect(cornerRadius: 12))
                }
                PrimaryButton(title: "Review Trade", systemImage: "eye") {
                    withAnimation(.snappy) { reviewing = true }
                }
                .disabled(give.isEmpty || get.isEmpty)
                .opacity(give.isEmpty || get.isEmpty ? 0.45 : 1)
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.immediately)
    }

    private func rosterPicker(title: String, team: Team, league: LeagueState, selection: Binding<Set<String>>, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TeamLogo(team: team, size: 24)
                Text(title).font(.headline).lineLimit(1)
                Spacer()
                Text("\(selection.wrappedValue.count) selected").font(.caption).foregroundStyle(Theme.muted)
            }
            VStack(spacing: 0) {
                ForEach(Slot.allCases) { slot in
                    if let aid = team.athlete(in: slot), let a = store.athlete(aid) {
                        let on = selection.wrappedValue.contains(aid)
                        Button {
                            Haptics.tap()
                            if on { selection.wrappedValue.remove(aid) } else { selection.wrappedValue.insert(aid) }
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                                    .font(.title3)
                                    .foregroundStyle(on ? tint : Theme.faint)
                                Text(slot.short)
                                    .font(.system(size: 12, weight: .heavy).width(.condensed))
                                    .foregroundStyle(PosStyle.color(slot))
                                    .frame(width: 34)
                                AthleteBadge(athlete: a, size: 34)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(a.shortName).font(.system(size: 15, weight: .heavy).width(.condensed))
                                    PosLabel(athlete: a)
                                }
                                Spacer()
                                Text(Fmt.pts(league.seasonPoints(aid))).font(Theme.score(16))
                            }
                            .padding(.horizontal, 14)
                            .frame(minHeight: 54)
                            .background(on ? tint.opacity(0.1) : .clear)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        RowDivider(inset: 14)
                    }
                }
            }
            .background(Theme.surface, in: .rect(cornerRadius: 16))
        }
    }

    private func review(_ league: LeagueState, _ me: Team, _ partner: Team) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                TradeSummaryCard(league: league, fromId: me.id, toId: partner.id, give: Array(give), get: Array(get), message: message)
                Text(reviewNote(league))
                    .font(.caption)
                    .foregroundStyle(Theme.muted)
                PrimaryButton(title: counterOf == nil ? "Send Trade Offer" : "Send Counter", systemImage: "paperplane.fill", isLoading: store.isBusy) {
                    var body: [String: Any] = ["type": "proposeTrade", "toId": partner.id, "give": Array(give), "get": Array(get), "message": message]
                    if let counterOf { body["counterOf"] = counterOf }
                    Task {
                        if await store.perform(body, success: "Trade offer sent to \(partner.teamName)") { dismiss() }
                    }
                }
            }
            .padding(16)
        }
    }

    private func reviewNote(_ league: LeagueState) -> String {
        switch league.settings.tradeReview {
        case "none": return "If accepted, the trade processes immediately."
        case "league": return "If accepted, the league has \(league.settings.tradeReviewDays) day(s) to vote. \(league.settings.vetoVotes) veto votes cancel it."
        default: return "If accepted, the commissioner reviews it before it processes."
        }
    }
}

/// Two-sided trade summary used by the review step and the Trades list.
struct TradeSummaryCard: View {
    let league: LeagueState
    let fromId: String
    let toId: String
    let give: [String]
    let get: [String]
    var message: String = ""
    @Environment(AppStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            side(team: league.team(fromId), label: "sends", ids: give)
            HStack {
                Rectangle().fill(Theme.line).frame(height: 1)
                Image(systemName: "arrow.up.arrow.down").font(.caption.weight(.bold)).foregroundStyle(Theme.green)
                Rectangle().fill(Theme.line).frame(height: 1)
            }
            side(team: league.team(toId), label: "sends", ids: get)
            if !message.isEmpty {
                Text("“\(message)”").font(.subheadline.italic()).foregroundStyle(Theme.muted)
            }
        }
        .card()
    }

    private func side(team: Team?, label: String, ids: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                TeamLogo(team: team, size: 24)
                Text("\(team?.teamName ?? "") \(label)").font(.subheadline.weight(.semibold)).lineLimit(1)
            }
            ForEach(ids, id: \.self) { id in
                let a = store.athlete(id)
                HStack(spacing: 10) {
                    AthleteBadge(athlete: a, size: 30)
                    Button {
                        store.sheet = .player(id)
                    } label: {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(a?.shortName ?? id).font(.system(size: 14, weight: .heavy).width(.condensed))
                            PosLabel(athlete: a)
                        }
                    }
                    .buttonStyle(.plain)
                    Spacer()
                    Text(Fmt.pts(league.seasonPoints(id))).font(Theme.score(15))
                }
            }
        }
    }
}
