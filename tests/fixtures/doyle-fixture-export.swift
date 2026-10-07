import Foundation
var allDays: [String: [Day]] = [:]
struct Row: Codable { let id: String; let title: String; let room: String; let start: String; let end: String }
struct Point: Codable { let id: String; let title: String; let time: String }
struct Day: Codable { let date: String; let rows: [Row]; let staff: [Row]; let points: [Point] }
for code in "abcdefghi" {
let definition = BuiltInSchoolDefinitions.doyleClassrooms["doyle.prek-\(code)"]!
var config = BellSyncConfiguration()
config.schoolProfileID = definition.id
config.profileSchoolSetup = .init(ownerProfileID: UUID(), definition: definition)
config.personalActivities = ProfilePersonalActivity.seed(definition)
config.personalActivitiesVersion = 1
let profile = PersonalScheduleProfile(name: definition.displayName, schoolProfileID: definition.id, schoolContentVersion: definition.contentVersion, scheduleConfiguration: config)
let shared = BellSyncSharedSchedule(profile: profile)
precondition(shared.validationError() == nil)
let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]; encoder.dateEncodingStrategy = .iso8601
try encoder.encode(shared).write(to: URL(fileURLWithPath: CommandLine.arguments[1] + "/prek-\(code).json"))
let engine = ScheduleEngine(profile: .custom(definition), calendarCorrections: []).configured(profile.scheduleConfiguration)
let clock = DateFormatter(); clock.dateFormat = "HH:mm"; clock.timeZone = engine.calendar.timeZone
let expected = definition.calendarExceptions.keys.sorted().map { key -> Day in
 let date = engine.calendar.date(from: BellSyncSchoolDefinition.dateComponents(for: key)!)!
 func rows(_ events: [SchoolEvent]) -> [Row] { events.filter { $0.start < $0.end }.map { Row(id: $0.id, title: $0.title, room: $0.room, start: clock.string(from: $0.start), end: clock.string(from: $0.end)) } }
 return Day(date: key, rows: rows(engine.genericEvents(on: date)), staff: rows(engine.secondaryStaffEvents(on: date)), points: engine.scheduledPointEvents(on: date).map { Point(id: $0.id, title: $0.title, time: $0.time) })
}
allDays[String(code)] = expected

}

let parityEncoder = JSONEncoder(); parityEncoder.outputFormatting = [.sortedKeys]
try parityEncoder.encode(allDays).write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
