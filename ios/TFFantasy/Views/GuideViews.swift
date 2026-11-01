import SwiftUI

// MARK: - Commissioner Guide

nonisolated struct GuideTopic: Identifiable, Hashable, Sendable {
    let id: Int
    let group: String
    let icon: String
    let title: String
    let summary: String
    let steps: [String]
    let where_: String

    func matches(_ q: String) -> Bool {
        let q = q.lowercased()
        return title.lowercased().contains(q) || summary.lowercased().contains(q) || steps.contains { $0.lowercased().contains(q) } || group.lowercased().contains(q)
    }
}

enum CommissionerGuide {
    static let topics: [GuideTopic] = [
        GuideTopic(id: 1, group: "Set Up", icon: "plus.circle.fill", title: "Creating a league",
                   summary: "Start a private league for your friends and share its invite code.",
                   steps: ["On Home, tap Create League.", "Name the league and your team, pick the school, and choose the league size.", "Share the invite code. Friends join with it from Home."],
                   where_: "Home › Create League"),
        GuideTopic(id: 2, group: "Set Up", icon: "building.columns.fill", title: "Selecting a school",
                   summary: "Every league drafts athletes from one school. Several leagues can pick the same school and share its athletes and results.",
                   steps: ["Pick the school when you create the league.", "Cornwall Central leagues use the Main League's shared meets and player list.", "Any other school's league schedules its own meets and builds its own roster."],
                   where_: "Create League › School"),
        GuideTopic(id: 3, group: "Athletes", icon: "square.and.arrow.down.fill", title: "Importing a school roster",
                   summary: "Paste a list or a spreadsheet export instead of typing every name.",
                   steps: ["Open Athlete Editor and tap Import Roster.", "Paste rows with name, boys/girls, position and grade.", "Check the preview: new, already there, possible duplicate, or uncertain.", "Confirm. Existing confirmed athletes are never overwritten."],
                   where_: "Commissioner Tools › Athlete Editor"),
        GuideTopic(id: 4, group: "Athletes", icon: "person.badge.plus", title: "Manually adding athletes",
                   summary: "Add one athlete at a time, for example a new team member mid-season.",
                   steps: ["Open Athlete Editor and tap Add One Player.", "Enter the name, boys/girls and position.", "Save. The athlete joins the school's shared list right away."],
                   where_: "Commissioner Tools › Athlete Editor"),
        GuideTopic(id: 5, group: "Athletes", icon: "pencil.circle.fill", title: "Editing athlete information",
                   summary: "Fix a name spelling, photo, position or note.",
                   steps: ["Open the athlete from Athlete Editor.", "Change the details and save.", "Changes show in every league on the same school."],
                   where_: "Commissioner Tools › Athlete Editor"),
        GuideTopic(id: 6, group: "Athletes", icon: "figure.run", title: "Assigning divisions and events",
                   summary: "Boys or girls, plus the athlete's position: Sprinter, Distance, Field, or a two-position mix.",
                   steps: ["Open the athlete in Athlete Editor.", "Set boys/girls and the position(s).", "Positions decide which lineup slots the athlete can fill. Points come from every event they actually compete in."],
                   where_: "Commissioner Tools › Athlete Editor"),
        GuideTopic(id: 7, group: "Athletes", icon: "person.fill.questionmark", title: "Correcting athlete identities",
                   summary: "When a result's name doesn't clearly match one athlete, it waits for you instead of guessing.",
                   steps: ["Open Unmatched Results.", "Pick the right athlete for each result, or mark it as someone not in the league.", "Approved matches are remembered for next time."],
                   where_: "Commissioner Tools › Unmatched Results"),
        GuideTopic(id: 8, group: "Athletes", icon: "person.fill.xmark", title: "Removing athletes from a league",
                   summary: "Take an athlete out of your league's pool without affecting other leagues.",
                   steps: ["Open the athlete in Athlete Editor.", "Tap Remove from Pool. Players on a roster, already drafted or with points can't be removed.", "Bring them back later with Add Back."],
                   where_: "Commissioner Tools › Athlete Editor"),
        GuideTopic(id: 9, group: "League", icon: "person.2.fill", title: "Managing league members",
                   summary: "Invite, remove and add co-managers.",
                   steps: ["Share the invite code to add members.", "Before the draft you can remove a team in Manage Teams.", "Members can add a co-manager to help run their team."],
                   where_: "Commissioner Tools › Manage Teams"),
        GuideTopic(id: 10, group: "League", icon: "tshirt.fill", title: "Managing fantasy teams",
                   summary: "Each member runs one team: name, photo, roster and lineup.",
                   steps: ["Members rename their team and add a photo on My Team.", "The draft needs an even number of teams so every team has an opponent at every meet.", "Waivers run every Wednesday; free agents can be added any time rosters aren't locked."],
                   where_: "My Team"),
        GuideTopic(id: 11, group: "Meets", icon: "calendar.badge.plus", title: "Scheduling meets",
                   summary: "School leagues add their own meets. Cornwall Central leagues use the Main League's meets.",
                   steps: ["Open Meet Center and tap Add Meet.", "Enter the meet name, location and results link if there is one.", "Turn on Schedule to set the start and end time."],
                   where_: "Commissioner Tools › Meet Center"),
        GuideTopic(id: 12, group: "Meets", icon: "clock.fill", title: "Setting meet start and end times",
                   summary: "Times are entered in the meet's own time zone, so travel and daylight saving are handled.",
                   steps: ["In the meet editor, set start, end and the meet's time zone.", "A meet can span several days.", "To move it later, use Reschedule so the change is logged."],
                   where_: "Meet Center › Meet"),
        GuideTopic(id: 13, group: "Meets", icon: "flag.2.crossed.fill", title: "Understanding meet-based matchups",
                   summary: "Each meet is one matchup, labeled with the meet's name. No meet means no matchup.",
                   steps: ["Every team plays one opponent per meet.", "Points come from your starters' real results at that meet.", "Standings record a win, loss or tie when the meet is final."],
                   where_: "Matchup tab"),
        GuideTopic(id: 14, group: "Meets", icon: "lock.fill", title: "Understanding roster locks",
                   summary: "Lineups lock at the meet's official start time.",
                   steps: ["Set lineups before the start time shown on the meet.", "Postponing a meet unlocks rosters until the new time.", "Waivers still run on Wednesday no matter when meets are."],
                   where_: "My Team"),
        GuideTopic(id: 15, group: "Meets", icon: "hourglass", title: "Understanding pending finalization",
                   summary: "After a meet ends, scores wait at least 24 hours before they're final, so late result fixes can come in.",
                   steps: ["Tap End Meet to start the 24-hour hold.", "If results look incomplete, the hold waits longer.", "You can Finalize Anyway with a reason; it's written to the audit log.", "After Final, changes need Correct Final Results and a reason."],
                   where_: "Meet Center › Meet"),
        GuideTopic(id: 16, group: "Meets", icon: "calendar.badge.exclamationmark", title: "Understanding postponed and canceled meets",
                   summary: "The matchup stays the same; only the meet's status changes.",
                   steps: ["Postpone holds the matchup open and unlocks rosters.", "Reschedule sets a new time and re-locks at the new start.", "Cancel closes the matchup with the points so far.", "Interrupt pauses a meet mid-way; Resume continues it.", "Every change is listed in the meet's change log."],
                   where_: "Meet Center › Meet"),
        GuideTopic(id: 17, group: "Scoring", icon: "function", title: "Understanding universal scoring",
                   summary: "Scoring is the same in every league, so points mean the same thing everywhere.",
                   steps: ["Only the platform commissioner can change scoring, after a preview.", "Finished weeks keep the scores they had.", "You can view every rule in Scoring Rules."],
                   where_: "Commissioner Tools › Scoring Rules"),
        GuideTopic(id: 18, group: "Scoring", icon: "chart.line.uptrend.xyaxis", title: "Understanding projected points",
                   summary: "PROJ numbers are estimates from past results. They never count toward real scores.",
                   steps: ["Projected: an estimate before or during a meet (marked PROJ).", "Actual: points from real results, which can still change while a meet is pending.", "Finalized: locked scores after the meet is final."],
                   where_: "Matchup tab, player cards"),
        GuideTopic(id: 19, group: "League", icon: "cross.case.fill", title: "Managing player statuses",
                   summary: "Active, Questionable, Doubtful, Out and IR help members plan lineups.",
                   steps: ["Open a player card and set the status.", "Statuses are informational; they don't change points.", "Only IR or Out players can go in the IR slot."],
                   where_: "Player card"),
        GuideTopic(id: 20, group: "League", icon: "bell.badge.fill", title: "Managing league notifications",
                   summary: "Each alert names its league, and each person picks what they get.",
                   steps: ["Open Settings › Notification settings to choose alert types.", "Use Test Notification to check delivery on your phone."],
                   where_: "Settings › Notification settings"),
        GuideTopic(id: 21, group: "Seasons", icon: "sun.max.fill", title: "Managing indoor and outdoor seasons",
                   summary: "Set Indoor or Outdoor before the draft. Start a new season when one ends.",
                   steps: ["Pick Indoor or Outdoor in Seasons before the draft.", "Start New Season saves the old season to Past Seasons, then clears rosters for a new draft.", "Members and team names stay. Past points never count in the new season."],
                   where_: "Commissioner Tools › Seasons"),
        GuideTopic(id: 22, group: "Seasons", icon: "archivebox.fill", title: "Viewing league history",
                   summary: "Past seasons keep standings, matchups, rosters, moves and the champion.",
                   steps: ["Open Past Seasons from Settings or Commissioner Tools.", "The Audit Log lists every commissioner change.", "Transactions show every add, drop, trade and claim this season."],
                   where_: "Settings › Past Seasons"),
        GuideTopic(id: 23, group: "League", icon: "person.crop.circle.badge.checkmark", title: "Transferring commissioner ownership",
                   summary: "A league always has a commissioner who is one of its members.",
                   steps: ["Hand off any time in Manage Teams › Make Commissioner.", "To leave before the draft, you'll pick who takes over first.", "Deleting your account also asks you to pick a successor for each league you run."],
                   where_: "Commissioner Tools › Manage Teams"),
        GuideTopic(id: 24, group: "Help", icon: "wrench.and.screwdriver.fill", title: "Troubleshooting common issues",
                   summary: "Quick fixes for the things that come up most.",
                   steps: ["Draft won't start: the league needs an even number of teams.", "A result is missing: check Unmatched Results, then add a Manual Result if the source never had it.", "Scores look off: run Reconcile Scores in Scoring Integrity.", "No push alerts: run Test Notification and check iPhone Settings › Notifications.", "Can't change a lineup: the meet has started and rosters are locked."],
                   where_: "Commissioner Tools"),
    ]
}

struct CommissionerGuideView: View {
    @State private var query: String = ""
    @State private var open: Set<Int> = []

    private var shown: [GuideTopic] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return q.isEmpty ? CommissionerGuide.topics : CommissionerGuide.topics.filter { $0.matches(q) }
    }

    var body: some View {
        List {
            if query.isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("COMMISSIONER GUIDE").font(.system(size: 11, weight: .heavy)).tracking(1.4).foregroundStyle(Theme.green)
                        Text("Run your league with confidence").font(Theme.display(26))
                        Text("24 short how-tos. Tap one to open it, or search.").font(.subheadline).foregroundStyle(Theme.muted)
                    }
                    .padding(.vertical, 6)
                }
                .listRowBackground(Color.clear)
            }
            let groups = Dictionary(grouping: shown, by: \.group)
            ForEach(["Set Up", "Athletes", "League", "Meets", "Scoring", "Seasons", "Help"], id: \.self) { g in
                if let rows = groups[g], !rows.isEmpty {
                    Section(g) {
                        ForEach(rows) { t in row(t) }
                    }
                }
            }
            if shown.isEmpty {
                ContentUnavailableView.search(text: query).listRowBackground(Color.clear)
            }
        }
        .screenBackground()
        .searchable(text: $query, prompt: "Search the guide")
        .navigationTitle("Guide")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func row(_ t: GuideTopic) -> some View {
        let expanded = open.contains(t.id) || !query.isEmpty
        return VStack(alignment: .leading, spacing: 10) {
            Button {
                Haptics.tap()
                withAnimation(.snappy) { if open.contains(t.id) { open.remove(t.id) } else { open.insert(t.id) } }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: t.icon)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Theme.green)
                        .frame(width: 32, height: 32)
                        .background(Theme.green.opacity(0.13), in: .rect(cornerRadius: 8))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(t.id). \(t.title)").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                        if !expanded { Text(t.summary).font(.caption).foregroundStyle(Theme.muted).lineLimit(1) }
                    }
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.faint)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            if expanded {
                Text(t.summary).font(.subheadline).foregroundStyle(Theme.muted)
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(t.steps.enumerated()), id: \.offset) { i, step in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text("\(i + 1)").font(.system(size: 12, weight: .heavy)).foregroundStyle(.black)
                                .frame(width: 20, height: 20).background(Theme.green, in: .circle)
                            Text(step).font(.subheadline)
                        }
                    }
                }
                Label(t.where_, systemImage: "location.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.gold)
            }
        }
        .padding(.vertical, 4)
        .listRowBackground(Theme.surface)
    }
}

// MARK: - How it works (after sign-up; reopenable from Settings)

private struct HowPage: Identifiable {
    let id: Int
    let icon: String
    let tint: Color
    let kicker: String
    let title: String
    let lines: [String]
}

struct HowItWorksView: View {
    @Environment(AppStore.self) private var store
    @State private var page: Int = 0

    private let pages: [HowPage] = [
        HowPage(id: 0, icon: "person.3.fill", tint: Theme.green, kicker: "1 · YOUR LEAGUE", title: "Join friends from your school",
                lines: ["Create a league or join one with an invite code.", "Each league picks a school and drafts its real athletes.", "You can be in several leagues; each one is separate."]),
        HowPage(id: 1, icon: "list.number", tint: Theme.gold, kicker: "2 · THE DRAFT", title: "Draft real athletes",
                lines: ["Take turns picking athletes in a live snake draft.", "Fill Sprinter, Distance, Field and Flex spots, plus a bench.", "After the draft, add free agents or claim players on Wednesday waivers."]),
        HowPage(id: 2, icon: "flag.2.crossed.fill", tint: Theme.sprint, kicker: "3 · MEET DAY", title: "One meet, one matchup",
                lines: ["Each meet you face one other team.", "Set your lineup before the meet starts. Lineups lock at the start time.", "Scores update live from real results."]),
        HowPage(id: 3, icon: "chart.line.uptrend.xyaxis", tint: Theme.distance, kicker: "4 · POINTS", title: "Projected, actual, final",
                lines: ["PROJ is an estimate. It is not a result and never counts.", "Actual points come from real performances, scored the same way in every league.", "Scores become final after the meet is finalized."]),
        HowPage(id: 4, icon: "sun.max.fill", tint: Theme.field, kicker: "5 · SEASONS", title: "Indoor and outdoor",
                lines: ["Leagues run indoor and outdoor seasons separately.", "Finished seasons are saved, with standings and champions, in Past Seasons.", "Alerts always name the league they're about. Pick which ones you want in Settings."]),
    ]

    var body: some View {
        ZStack {
            TrackBackground()
            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    Button("Skip") { finish() }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                        .opacity(page == pages.count - 1 ? 0 : 1)
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                TabView(selection: $page) {
                    ForEach(pages) { p in pageView(p).tag(p.id) }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                HStack(spacing: 6) {
                    ForEach(pages) { p in
                        Capsule()
                            .fill(p.id == page ? Theme.green : Theme.raised)
                            .frame(width: p.id == page ? 22 : 8, height: 8)
                    }
                }
                .animation(.snappy, value: page)
                .padding(.bottom, 20)
                PrimaryButton(title: page == pages.count - 1 ? "Get Started" : "Next", systemImage: page == pages.count - 1 ? "checkmark" : "arrow.right") {
                    if page == pages.count - 1 { finish() } else { withAnimation(.snappy) { page += 1 } }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 16)
            }
        }
        .sensoryFeedback(.selection, trigger: page)
        .preferredColorScheme(.dark)
    }

    private func pageView(_ p: HowPage) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Spacer(minLength: 10)
            Image(systemName: p.icon)
                .font(.system(size: 40, weight: .bold))
                .foregroundStyle(p.tint)
                .frame(width: 84, height: 84)
                .background(p.tint.opacity(0.14), in: .rect(cornerRadius: 22))
                .symbolEffect(.bounce, value: page == p.id)
            Text(p.kicker).font(.system(size: 12, weight: .heavy)).tracking(2).foregroundStyle(p.tint)
            Text(p.title).font(Theme.display(40)).lineSpacing(-4)
            VStack(alignment: .leading, spacing: 14) {
                ForEach(Array(p.lines.enumerated()), id: \.offset) { _, line in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Circle().fill(p.tint).frame(width: 7, height: 7)
                        Text(line).font(.body).foregroundStyle(.white.opacity(0.88))
                    }
                }
            }
            Spacer()
        }
        .padding(.horizontal, 28)
    }

    private func finish() {
        store.showHowItWorks = false
    }
}
