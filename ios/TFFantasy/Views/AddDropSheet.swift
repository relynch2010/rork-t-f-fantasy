import SwiftUI

/// Yahoo add/drop flow: pick who to drop (if needed), set a bid for budget waivers, confirm.
struct AddDropSheet: View {
    let athleteId: String
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var dropId: String?
    @State private var bid: Int = 0

    var body: some View {
        NavigationStack {
            Group {
                if let league = store.league, let me = league.myTeam, let add = store.athlete(athleteId) {
                    content(league, me, add)
                }
            }
            .background(Theme.bg)
            .navigationTitle(isWaiver ? (store.league?.settings.isFAAB == true ? "Place Bid" : "Waiver Claim") : "Add Player")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
        .presentationDetents([.large])
        .presentationBackground(Theme.bg)
    }

    private var isWaiver: Bool { store.league?.waivers[athleteId] != nil }

    private func content(_ league: LeagueState, _ me: Team, _ add: Athlete) -> some View {
        let full = !league.hasOpenSpot(for: add, team: me)
        let existing = league.pendingClaims.first { $0.addId == athleteId }
        return ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("ADDING").font(.system(size: 11, weight: .heavy)).tracking(1).foregroundStyle(Theme.green)
                    HStack(spacing: 12) {
                        AthleteBadge(athlete: add, size: 48)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(add.shortName).font(Theme.playerName)
                            PosLabel(athlete: add, suffix: add.gender.label)
                        }
                        Spacer()
                        Text(Fmt.pts(league.seasonPoints(add.id))).font(Theme.score(20))
                    }
                    if case .waivers(let until) = league.availability(add.id) {
                        Label("On waivers until \(Fmt.dateTime(until)). Claims process automatically.", systemImage: "clock")
                            .font(.caption)
                            .foregroundStyle(Theme.gold)
                    }
                }
                .card()

                if isWaiver, league.settings.isFAAB {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("Your bid").font(.headline)
                            Spacer()
                            Text("$\(me.faab) left").font(.subheadline).foregroundStyle(Theme.muted)
                        }
                        HStack(spacing: 16) {
                            stepButton("minus") { bid = max(0, bid - 1) }
                            Text("$\(bid)")
                                .font(Theme.score(44))
                                .frame(maxWidth: .infinity)
                                .contentTransition(.numericText())
                                .animation(.snappy, value: bid)
                            stepButton("plus") { bid = min(me.faab, bid + 1) }
                        }
                        HStack(spacing: 8) {
                            ForEach([1, 5, 10, 25], id: \.self) { v in
                                ChipButton(title: "+$\(v)") { bid = min(me.faab, bid + v) }
                            }
                        }
                        Text("Highest bid wins. Ties go to the better waiver priority.").font(.caption).foregroundStyle(Theme.muted)
                    }
                    .card()
                }

                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Text(full ? "Choose a player to drop" : "Drop a player (optional)").font(.headline)
                        Spacer()
                        Text("\(me.roster.count)/\(Slot.allCases.count)").font(.subheadline).foregroundStyle(Theme.muted)
                    }
                    .padding(.bottom, 10)
                    VStack(spacing: 0) {
                        ForEach(Slot.allCases) { slot in
                            if let aid = me.athlete(in: slot), let a = store.athlete(aid) {
                                Button {
                                    Haptics.tap()
                                    dropId = dropId == aid ? nil : aid
                                } label: {
                                    HStack(spacing: 12) {
                                        Image(systemName: dropId == aid ? "minus.circle.fill" : "circle")
                                            .font(.title3)
                                            .foregroundStyle(dropId == aid ? Theme.red : Theme.faint)
                                        Text(slot.short)
                                            .font(.system(size: 12, weight: .heavy).width(.condensed))
                                            .foregroundStyle(PosStyle.color(slot))
                                            .frame(width: 34)
                                        AthleteBadge(athlete: a, size: 36)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(a.shortName).font(.system(size: 15, weight: .heavy).width(.condensed))
                                            PosLabel(athlete: a)
                                        }
                                        Spacer()
                                        Text(Fmt.pts(league.seasonPoints(a.id))).font(Theme.score(16))
                                    }
                                    .padding(.horizontal, 14)
                                    .frame(minHeight: 56)
                                    .background(dropId == aid ? Theme.red.opacity(0.12) : .clear)
                                    .contentShape(.rect)
                                }
                                .buttonStyle(.plain)
                                RowDivider(inset: 14)
                            }
                        }
                    }
                    .background(Theme.surface, in: .rect(cornerRadius: 16))
                }

                if let existing {
                    Text("You already have a claim on \(add.firstName)\(existing.bid > 0 ? " ($\(existing.bid))" : ""). Submitting replaces it.")
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                }

                PrimaryButton(title: submitTitle(league), systemImage: isWaiver ? "hand.raised.fill" : "plus", isLoading: store.isBusy) {
                    submit(league, add)
                }
                .disabled(full && dropId == nil)
                .opacity(full && dropId == nil ? 0.45 : 1)

                if league.settings.maxAddsPerWeek > 0 {
                    Text("\(me.addsThisWeek) of \(league.settings.maxAddsPerWeek) adds used this week")
                        .font(.caption)
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(16)
        }
    }

    private func submitTitle(_ league: LeagueState) -> String {
        if isWaiver { return league.settings.isFAAB ? "Submit $\(bid) Bid" : "Submit Claim" }
        return dropId == nil ? "Add Player" : "Add & Drop"
    }

    private func stepButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .bold))
                .frame(width: 48, height: 48)
                .background(Theme.surface2, in: .circle)
        }
        .buttonStyle(PressableStyle())
    }

    private func submit(_ league: LeagueState, _ add: Athlete) {
        var body: [String: Any] = ["type": isWaiver ? "claim" : "addDrop", "addId": add.id]
        if let dropId { body["dropId"] = dropId }
        if isWaiver, league.settings.isFAAB { body["bid"] = bid }
        let message = isWaiver ? "Claim placed for \(add.name)" : "Added \(add.name)"
        Task {
            if await store.perform(body, success: message) { dismiss() }
        }
    }
}
