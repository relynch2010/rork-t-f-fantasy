import SwiftUI

/// Commissioner-only. Type the league name to confirm; the server re-checks the role and name, then deletes atomically.
struct DeleteLeagueView: View {
    @Environment(AppStore.self) private var store
    @State private var typed: String = ""
    @State private var confirm: Bool = false

    var body: some View {
        ScrollView {
            if let league = store.league {
                VStack(alignment: .leading, spacing: 18) {
                    Image(systemName: "exclamationmark.octagon.fill")
                        .font(.system(size: 44))
                        .foregroundStyle(Theme.red)
                    Text("Delete \(league.name)?").font(Theme.display(30))
                    VStack(alignment: .leading, spacing: 8) {
                        Text("This permanently removes, for everyone:").font(.subheadline.weight(.semibold))
                        Text("Teams, rosters, the draft, matchups, standings, activity, notifications, meets, player photos, mock drafts and every membership. The invite code \(league.code) stops working.")
                            .font(.subheadline).foregroundStyle(Theme.muted)
                        Text("Kept: everyone's account, the shared athlete list and every other league.")
                            .font(.subheadline).foregroundStyle(Theme.muted)
                    }
                    .card()
                    if league.isCommissioner {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Type the league name to confirm").font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
                            TextField(league.name, text: $typed)
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                                .padding(.horizontal, 14)
                                .frame(height: 50)
                                .background(Theme.surface, in: .rect(cornerRadius: 14))
                                .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(matches(league) ? Theme.red : Theme.line))
                        }
                        PrimaryButton(title: "Delete League Forever", systemImage: "trash.fill", tint: Theme.red, isLoading: store.isBusy) {
                            confirm = true
                        }
                        .disabled(!matches(league))
                        .opacity(matches(league) ? 1 : 0.4)
                    } else {
                        Text("Only the commissioner can delete this league.").foregroundStyle(Theme.muted)
                    }
                }
                .padding()
            }
        }
        .background(TrackBackground())
        .navigationTitle("Delete League")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("This can't be undone.", isPresented: $confirm, titleVisibility: .visible) {
            Button("Delete League", role: .destructive) {
                Task { _ = await store.deleteLeague(confirmName: typed) }
            }
        }
    }

    private func matches(_ league: LeagueState) -> Bool {
        typed.trimmingCharacters(in: .whitespaces) == league.name.trimmingCharacters(in: .whitespaces)
    }
}
