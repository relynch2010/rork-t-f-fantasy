import ActivityKit
import Foundation

/// Live Activity payload for a weekly matchup.
/// Keep this identical to `TFFantasyWidget/MatchupAttributes.swift` — the backend
/// pushes `ContentState` keys (myScore, oppScore, myLeader, status, detail, myProj, oppProj, leagueName) by name.
nonisolated struct MatchupAttributes: ActivityAttributes {
    nonisolated struct ContentState: Codable, Hashable {
        var myScore: Double
        var oppScore: Double
        var myLeader: String
        var status: String
        var detail: String
        /// Projected final totals (live score + what's still to come). Optional: older servers don't send them.
        var myProj: Double? = nil
        var oppProj: Double? = nil
        /// League name as the server sends it (falls back to the attributes' name).
        var leagueName: String? = nil
    }

    var activityId: String
    var leagueId: String
    var leagueName: String
    var week: Int
    var teamId: String
    var myTeam: String
    var oppTeam: String
    var myColor: String
    var oppColor: String
}
