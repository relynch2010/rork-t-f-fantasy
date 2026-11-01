import SwiftUI

struct LeaguesView: View {
    @Environment(AppStore.self) private var store
    @State private var showCreate: Bool = false
    @State private var showJoin: Bool = false
    @State private var showAll: Bool = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Hey, \(store.user?.name.split(separator: " ").first.map(String.init) ?? "Coach")")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.green)
                        Text("Your Leagues")
                            .font(Theme.display(40))
                    }
                    .padding(.top, 12)

                    let visible = store.leagues.filter { !$0.isHidden }
                    let hidden = store.leagues.filter(\.isHidden)
                    if store.leagues.isEmpty {
                        EmptyStateView(
                            icon: "figure.run",
                            title: "No leagues yet",
                            message: "Start one for your team and share the invite code, or join with a code from your commissioner."
                        )
                        .card()
                    } else {
                        VStack(spacing: 12) {
                            ForEach(visible) { summary in leagueButton(summary) }
                            if visible.isEmpty {
                                Text("Every league is hidden. Open All Leagues to see them.")
                                    .font(.subheadline).foregroundStyle(Theme.muted)
                                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                            }
                        }
                        if !hidden.isEmpty {
                            VStack(alignment: .leading, spacing: 12) {
                                Button {
                                    Haptics.tap()
                                    withAnimation(.snappy) { showAll.toggle() }
                                } label: {
                                    HStack {
                                        Text("All Leagues").font(.headline)
                                        Text("\(hidden.count) hidden").font(.caption.weight(.semibold)).foregroundStyle(Theme.muted)
                                        Spacer()
                                        Image(systemName: showAll ? "chevron.up" : "chevron.down").font(.caption.weight(.bold))
                                    }
                                    .foregroundStyle(.white)
                                }
                                if showAll {
                                    ForEach(hidden) { summary in leagueButton(summary).opacity(0.75) }
                                }
                            }
                        }
                    }

                    VStack(spacing: 12) {
                        PrimaryButton(title: "Create a league", systemImage: "plus") { showCreate = true }
                        SecondaryButton(title: "Join with code", systemImage: "ticket") { showJoin = true }
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 32)
            }
            .screenBackground()
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Text(store.user?.email ?? "")
                        Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) { store.signOut() }
                    } label: {
                        Image(systemName: "person.crop.circle")
                    }
                    .accessibilityLabel("Account")
                }
            }
            .refreshable { await store.refreshLeagues() }
            .task { await store.refreshLeagues() }
            .sheet(isPresented: $showCreate) { CreateLeagueSheet() }
            .sheet(isPresented: $showJoin) { JoinLeagueSheet() }
        }
    }
}

extension LeaguesView {
    fileprivate func leagueButton(_ summary: LeagueSummary) -> some View {
        Button {
            Haptics.tap()
            store.open(leagueId: summary.leagueId)
        } label: {
            LeagueCard(summary: summary)
        }
        .buttonStyle(PressableStyle())
        .contextMenu {
            if summary.isHidden {
                Button("Show on Home", systemImage: "eye") { Task { await store.setHidden(summary.leagueId, hidden: false) } }
            } else {
                Button("Hide from Home", systemImage: "eye.slash") { Task { await store.setHidden(summary.leagueId, hidden: true) } }
            }
        }
    }
}

private struct LeagueCard: View {
    let summary: LeagueSummary

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "trophy.fill")
                .font(.title3)
                .foregroundStyle(.black)
                .frame(width: 48, height: 48)
                .background(Theme.green.gradient, in: .rect(cornerRadius: 14))
            VStack(alignment: .leading, spacing: 3) {
                Text(summary.name)
                    .font(.headline)
                    .foregroundStyle(.white)
                HStack(spacing: 6) {
                    Text("Code \(summary.code)")
                        .font(.caption.weight(.semibold).monospaced())
                        .foregroundStyle(Theme.muted)
                    if summary.isHidden {
                        Label("Hidden", systemImage: "eye.slash").font(.caption2.weight(.bold)).foregroundStyle(Theme.faint)
                    }
                }
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(Theme.faint)
        }
        .card(padding: 14)
    }
}

struct CreateLeagueSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var name: String = ""
    @State private var teamName: String = ""
    @State private var maxTeams: Int = 12

    var body: some View {
        NavigationStack {
            Form {
                Section("League") {
                    TextField("League name", text: $name)
                    TextField("Your team name", text: $teamName)
                }
                Section {
                    Stepper("Max teams: \(maxTeams)", value: $maxTeams, in: 2...14)
                } header: {
                    Text("League Size")
                } footer: {
                    Text("Scoring, roster spots, season length, playoffs, waivers, trades and every meet come from the Main League, so every league plays by the same rules. Set the draft time and order later in League Settings.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .navigationTitle("New League")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if store.isBusy {
                        ProgressView()
                    } else {
                        Button("Create") {
                            Task {
                                let ok = await store.createLeague(
                                    name: name,
                                    teamName: teamName,
                                    settings: ["maxTeams": maxTeams]
                                )
                                if ok { dismiss() }
                            }
                        }
                        .fontWeight(.bold)
                    }
                }
            }
        }
        .presentationDetents([.large])
    }
}

struct JoinLeagueSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var code: String = ""
    @State private var teamName: String = ""
    @State private var asCoManager: Bool = false
    @State private var preview: CoInvitePreview?
    @FocusState private var codeFocused: Bool

    private var codeLength: Int { asCoManager ? 7 : 6 }

    private var cleanCode: String {
        String(code.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(codeLength))
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Picker("", selection: $asCoManager) {
                    Text("My own team").tag(false)
                    Text("Co-manager").tag(true)
                }
                .pickerStyle(.segmented)
                .onChange(of: asCoManager) { _, _ in code = ""; preview = nil }
                Text(asCoManager ? "Enter the 7-character co-manager code from the team's manager." : "Enter the 6-character code from your commissioner.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.muted)
                    .multilineTextAlignment(.center)
                    .padding(.top, 8)

                TextField("", text: $code, prompt: Text("ABC123").foregroundStyle(Theme.faint))
                    .font(.system(size: 40, weight: .black, design: .monospaced))
                    .multilineTextAlignment(.center)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .focused($codeFocused)
                    .onChange(of: code) { _, newValue in
                        let cleaned = String(newValue.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(codeLength))
                        if cleaned != newValue { code = cleaned }
                        preview = nil
                    }
                    .frame(height: 80)
                    .background(Theme.surface, in: .rect(cornerRadius: 20))
                    .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(codeFocused ? Theme.green : Theme.line))

                if asCoManager {
                    coSection
                } else {
                    TextField("Your team name", text: $teamName)
                        .padding(.horizontal, 16)
                        .frame(height: 52)
                        .background(Theme.surface, in: .rect(cornerRadius: 16))
                        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Theme.line))

                    PrimaryButton(title: "Join league", systemImage: "person.badge.plus", isLoading: store.isBusy) {
                        Task {
                            if await store.joinLeague(code: cleanCode, teamName: teamName) { dismiss() }
                        }
                    }
                    .opacity(cleanCode.count == 6 ? 1 : 0.45)
                    .disabled(cleanCode.count != 6)
                }

                Spacer()
            }
            .padding(.horizontal)
            .navigationTitle("Join a League")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .onAppear { codeFocused = true }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder
    private var coSection: some View {
        if let p = preview {
            VStack(alignment: .leading, spacing: 6) {
                Text("CO-MANAGE").font(.system(size: 11, weight: .heavy)).tracking(1).foregroundStyle(Theme.gold)
                Text(p.teamName).font(Theme.display(26))
                Text("\(p.ownerName)'s team in \(p.leagueName)").font(.subheadline).foregroundStyle(Theme.muted)
            }
            .card()
            HStack(spacing: 10) {
                SecondaryButton(title: "Decline", systemImage: "xmark") {
                    Task { await store.declineCoInvite(code: cleanCode); dismiss() }
                }
                PrimaryButton(title: "Accept", systemImage: "checkmark", isLoading: store.isBusy) {
                    Task { if await store.acceptCoInvite(code: cleanCode) { dismiss() } }
                }
            }
        } else {
            PrimaryButton(title: "Look up invite", systemImage: "magnifyingglass", isLoading: store.isBusy) {
                Task { preview = await store.previewCoInvite(code: cleanCode) }
            }
            .opacity(cleanCode.count == 7 ? 1 : 0.45)
            .disabled(cleanCode.count != 7)
        }
    }
}
