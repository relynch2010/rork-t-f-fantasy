import SwiftUI

/// League → Draft: countdown, draft order, members, and commissioner draft controls.
struct DraftLobbyView: View {
    @Environment(AppStore.self) private var store
    @State private var confirmStart: Bool = false

    var body: some View {
        ScrollView {
            if let league = store.league {
                VStack(alignment: .leading, spacing: 18) {
                    if league.phaseKind == .predraft || league.phaseKind == .drafting {
                        DraftCountdownCard(league: league)
                    } else {
                        HStack(spacing: 12) {
                            Image(systemName: "checkmark.seal.fill").font(.title).foregroundStyle(Theme.green)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Draft complete").font(Theme.display(24))
                                Text("\(league.draft.picks.count) picks • \(league.draft.rounds) rounds").font(.subheadline).foregroundStyle(Theme.muted)
                            }
                        }
                        .card()
                        PrimaryButton(title: "View Draft Results", systemImage: "list.bullet.rectangle") { store.showDraftRoom = true }
                    }

                    if league.isCommissioner, league.phaseKind == .predraft {
                        commishControls(league)
                    }

                    orderSection(league)

                    VStack(alignment: .leading, spacing: 6) {
                        Text("How it works").font(.headline)
                        Text("Snake draft, \(league.draft.rounds) rounds: Sprinter, Distance, Field, Flex and 2 Bench. \(league.settings.pickSeconds)s per pick. Only the team on the clock can pick. If time runs out, you auto-pick from your queue, then the top-ranked athlete who fits your roster.")
                            .font(.subheadline)
                            .foregroundStyle(Theme.muted)
                    }
                    .card()
                }
                .padding(16)
            }
        }
        .background(TrackBackground())
        .navigationTitle("Draft")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Start the draft now?", isPresented: $confirmStart, titleVisibility: .visible) {
            Button("Start Draft") { Task { await store.perform(["type": "startDraft"]) } }
        } message: {
            Text("Everyone gets a push. Teams can't join after this.")
        }
    }

    private func commishControls(_ league: LeagueState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("COMMISSIONER").font(.system(size: 11, weight: .heavy)).tracking(1).foregroundStyle(Theme.gold)
            let odd = league.teams.count % 2 != 0
            if odd {
                Label("The draft needs an even number of teams so every team has an opponent at every meet. You have \(league.teams.count). Invite one more team or remove one.", systemImage: "person.2.slash")
                    .font(.footnote)
                    .foregroundStyle(Theme.gold)
            }
            PrimaryButton(title: "Start Draft Now", systemImage: "play.fill") { confirmStart = true }
                .opacity(league.teams.count < 2 || odd ? 0.45 : 1)
                .disabled(league.teams.count < 2 || odd)
            NavigationLink(value: LeagueRoute.adpReview) {
                Label("Draft Rankings (ADP)", systemImage: "list.star")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 46)
                    .background(Theme.surface2, in: .capsule)
                    .overlay(Capsule().strokeBorder(Theme.line))
            }
            .buttonStyle(PressableStyle())
            HStack(spacing: 10) {
                SecondaryButton(title: "Randomize Order", systemImage: "shuffle") {
                    Task { await store.perform(["type": "randomizeOrder"], success: "Draft order set") }
                }
                NavigationLink(value: LeagueRoute.editSettings) {
                    Label(draftLocked(league) ? "Time Locked" : "Draft Time", systemImage: draftLocked(league) ? "lock.fill" : "calendar")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 46)
                        .background(Theme.surface2, in: .capsule)
                        .overlay(Capsule().strokeBorder(Theme.line))
                }
                .buttonStyle(PressableStyle())
            }
        }
        .card()
    }

    private func draftLocked(_ league: LeagueState) -> Bool {
        guard let at = league.settings.draftAt else { return false }
        return at - store.serverNowMs < 30 * 60 * 1000
    }

    private func orderSection(_ league: LeagueState) -> some View {
        let order: [String] = league.draft.order.isEmpty ? league.teams.map(\.id) : league.draft.order
        let isSet = !league.draft.order.isEmpty
        let canEdit = league.isCommissioner && league.phaseKind == .predraft && isSet
        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(isSet ? "Draft Order" : "Teams").font(.system(size: 20, weight: .bold))
                Spacer()
                if !isSet {
                    Text(league.settings.draftOrderMode == "random" ? "Randomized at start" : "Not set")
                        .font(.caption).foregroundStyle(Theme.muted)
                }
            }
            .padding(.bottom, 10)
            VStack(spacing: 0) {
                ForEach(Array(order.enumerated()), id: \.element) { index, id in
                    let team = league.team(id)
                    HStack(spacing: 12) {
                        Text(isSet ? "\(index + 1)" : "•")
                            .font(Theme.score(18))
                            .foregroundStyle(Theme.muted)
                            .frame(width: 26)
                        TeamLogo(team: team, size: 32)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(team?.teamName ?? "").font(.system(size: 15, weight: id == league.me ? .bold : .medium))
                            Text(team?.ownerName ?? "").font(.caption).foregroundStyle(Theme.muted)
                        }
                        Spacer()
                        if id == league.commissionerId {
                            Image(systemName: "crown.fill").font(.caption).foregroundStyle(Theme.gold)
                        }
                        if canEdit {
                            Button { move(order, index, -1) } label: { Image(systemName: "chevron.up").frame(width: 32, height: 36) }
                                .disabled(index == 0)
                            Button { move(order, index, 1) } label: { Image(systemName: "chevron.down").frame(width: 32, height: 36) }
                                .disabled(index == order.count - 1)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    if index < order.count - 1 { RowDivider(inset: 52) }
                }
            }
            .background(Theme.surface, in: .rect(cornerRadius: 16))
        }
    }

    private func move(_ order: [String], _ index: Int, _ delta: Int) {
        var next = order
        let target = index + delta
        guard next.indices.contains(target) else { return }
        next.swapAt(index, target)
        Haptics.tap()
        Task { await store.perform(["type": "setOrder", "order": next]) }
    }
}
