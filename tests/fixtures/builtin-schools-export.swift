import Foundation
var allDays: [String: [Day]] = [:]
struct Row: Codable { let id: String; let title: String; let room: String; let start: String; let end: String }
struct Point: Codable { let id: String; let title: String; let time: String }
struct Day: Codable { let date: String; let rows: [Row]; let staff: [Row]; let points: [Point] }
struct Choice: Codable { let code: String; let label: String; let schoolProfileID: String }
let schools: [(String, [BellSyncSchoolDefinition])] = [("woodville", Array(BuiltInSchoolDefinitions.woodvilleClassrooms.values)), ("ferryway", [BuiltInSchoolDefinitions.ferryway]), ("walton", Array(BuiltInSchoolDefinitions.waltonClassrooms.values))]
for (school, definitions) in schools {
var choices: [Choice] = []
for definition in definitions.sorted(by: { $0.id < $1.id }) {
let code = definition.id.split(separator: ".").last.map(String.init)!
let label = school == "ferryway" ? definition.displayName : "\(school.capitalized) \(definition.activityPresentation!.contextLabel)"
choices.append(Choice(code: code, label: label, schoolProfileID: definition.id))
var config = BellSyncConfiguration()
config.schoolProfileID = definition.id
config.profileSchoolSetup = .init(ownerProfileID: UUID(), definition: definition)
config.personalActivities = ProfilePersonalActivity.seed(definition)
config.personalActivitiesVersion = 1
let profile = PersonalScheduleProfile(name: label, schoolProfileID: definition.id, schoolContentVersion: definition.contentVersion, scheduleConfiguration: config)
let shared = BellSyncSharedSchedule(profile: profile)
precondition(shared.validationError() == nil)
let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]; encoder.dateEncodingStrategy = .iso8601
try encoder.encode(shared).write(to: URL(fileURLWithPath: CommandLine.arguments[1] + "/\(school)/\(code).json"))
let engine = ScheduleEngine(profile: .custom(definition), calendarCorrections: []).configured(profile.scheduleConfiguration)
let clock = DateFormatter(); clock.dateFormat = "HH:mm"; clock.timeZone = engine.calendar.timeZone
let calendar = engine.calendar
var cursor = calendar.date(from: BellSyncSchoolDefinition.dateComponents(for: "2026-09-02")!)!
let last = calendar.date(from: BellSyncSchoolDefinition.dateComponents(for: "2027-06-22")!)!
var dates: [String] = []
while cursor <= last { dates.append(BellSyncSchoolDefinition.dateKey(cursor, calendar: calendar));cursor = calendar.date(byAdding: .day, value: 1, to: cursor)! }
let expected = dates.map { key -> Day in
 let date = engine.calendar.date(from: BellSyncSchoolDefinition.dateComponents(for: key)!)!
 func rows(_ events: [SchoolEvent]) -> [Row] { events.filter { $0.start < $0.end }.map { Row(id: $0.id, title: $0.title, room: $0.room, start: clock.string(from: $0.start), end: clock.string(from: $0.end)) } }
 return Day(date: key, rows: rows(engine.genericEvents(on: date)), staff: rows(engine.secondaryStaffEvents(on: date)), points: engine.scheduledPointEvents(on: date).map { Point(id: $0.id, title: $0.title, time: $0.time) })
}
allDays[definition.id] = expected

}

let manifest = JSONEncoder(); manifest.outputFormatting = [.prettyPrinted, .sortedKeys]
try manifest.encode(choices).write(to: URL(fileURLWithPath: CommandLine.arguments[1] + "/\(school)/profiles.json"))
}
let parityEncoder = JSONEncoder(); parityEncoder.outputFormatting = [.sortedKeys]
try parityEncoder.encode(allDays).write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
