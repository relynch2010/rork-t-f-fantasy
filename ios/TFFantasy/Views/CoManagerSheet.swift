import SwiftUI

/// Invite, cancel or remove the one co-manager for a team. Co-managers can also leave here.
struct CoManagerSheet: View {
    let teamId: String
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var confirmRemove: Bool = false
    @State private var confirmLeave: Bool = false

    var body: some View {
        NavigationStack {
            ScrollView {
                if let league = store.league, let team = league.team(teamId) {
                    VStack(alignment: .leading, spacing: 18) {
                        HStack(spacing: 12) {
                            Image(systemName: "person.2.fill")
                                .font(.title2)
                                .foregroundStyle(.black)
                                .frame(width: 52, height: 52)
                                .background(Theme.green.gradient, in: .rect(cornerRadius: 14))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(team.teamName).font(Theme.display(24))
                                Text("Managed by \(team.ownerName)\(team.coManagerName.map { " & \($0)" } ?? "")")
                                    .font(.subheadline).foregroundStyle(Theme.muted)
                            }
                        }
                        Text("A co-manager can set the lineup, add and drop, handle bench and IR, place waiver claims, trade, make draft picks and change the team photo. They get this team's notifications. They're never the commissioner.")
                            .font(.subheadline)
                            .foregroundStyle(Theme.muted)

                        if league.isCoManager {
                            coView(team)
                        } else if let name = team.coManagerName {
                            VStack(alignment: .leading, spacing: 10) {
                                Label("\(name) is co-managing", systemImage: "checkmark.seal.fill")
                                    .font(.headline).foregroundStyle(Theme.green)
                                Button(role: .destructive) { confirmRemove = true } label: {
                                    Label("Remove co-manager", systemImage: "person.fill.xmark")
                                        .frame(maxWidth: .infinity, minHeight: 46)
                                }
                                .buttonStyle(.bordered)
                                .tint(Theme.red)
                            }
                            .card()
                        } else if let invite = team.coInvite {
                            inviteCard(invite, league: league)
                        } else {
                            PrimaryButton(title: "Create invite code", systemImage: "person.badge.plus", isLoading: store.isBusy) {
                                Task { await store.perform(["type": "createCoInvite"], success: "Invite ready") }
                            }
                        }
                    }
                    .padding()
                }
            }
            .background(TrackBackground())
            .navigationTitle("Co-manager")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .confirmationDialog("Remove your co-manager?", isPresented: $confirmRemove, titleVisibility: .visible) {
                Button("Remove", role: .destructive) { Task { await store.perform(["type": "removeCoManager"], success: "Co-manager removed") } }
            } message: {
                Text("Only their access ends. Your roster, history and standings stay the same.")
            }
            .confirmationDialog("Stop co-managing?", isPresented: $confirmLeave, titleVisibility: .visible) {
                Button("Leave Team", role: .destructive) {
                    Task {
                        if await store.perform(["type": "leaveCoManager"]) {
                            dismiss()
                            store.leagueRemoved("You're no longer co-managing that team.")
                        }
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
        .presentationDetents([.medium, .large])
    }

    private func inviteCard(_ invite: CoInvite, league: LeagueState) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("INVITE CODE").font(.system(size: 11, weight: .heavy)).tracking(1).foregroundStyle(Theme.gold)
            Text(invite.code)
                .font(.system(size: 38, weight: .black, design: .monospaced))
                .textSelection(.enabled)
            Text("They open Fantasy T&F, tap Join with code, then Co-manager, and enter this code. They can accept or decline.")
                .font(.caption).foregroundStyle(Theme.muted)
            HStack(spacing: 10) {
                ShareLink(item: "Co-manage my team in \"\(league.name)\" on Fantasy T&F. Tap Join with code → Co-manager and enter \(invite.code)") {
                    Label("Share", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.green)
                Button(role: .destructive) {
                    Task { await store.perform(["type": "cancelCoInvite"], success: "Invite cancelled") }
                } label: {
                    Text("Cancel invite").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
            }
        }
        .card()
    }

    private func coView(_ team: Team) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("You're co-managing with \(team.ownerName)", systemImage: "person.2.fill")
                .font(.headline).foregroundStyle(Theme.green)
            Button(role: .destructive) { confirmLeave = true } label: {
                Text("Stop co-managing").frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)
            .tint(Theme.red)
        }
        .card()
    }
}
