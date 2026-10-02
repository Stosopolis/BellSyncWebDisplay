    static func loadGMS(from directory: URL) throws -> SchoolProfile {
        let calendar = try JSONDecoder().decode(SchoolCalendar.self, from: Data(contentsOf: directory.appendingPathComponent("gms-calendar.json")))
        let empty = SchoolSchedule(bells: [:], assignments: [:], colors: [:], time_zone: "America/New_York")
        func p(_ id: String, _ start: String, _ end: String, _ title: String = "") -> GMSRules.Period { .init(id: id, start: start, end: end, title: title) }
        let hr = p("HR","07:45","07:47","Homeroom")
        let common1 = p("P1","07:49","08:38")
        let regular: [Int:[GMSRules.Period]] = [
          5:[hr,common1,p("P2","08:40","09:40"),p("P3","09:42","10:22"),p("P4","10:24","11:14"),p("P5","11:42","12:42"),p("P6","12:44","13:24"),p("P7","13:26","14:15")],
          6:[hr,common1,p("P2","08:40","09:30"),p("P3","09:32","10:22"),p("P4","10:24","11:14","P4 / Snack"),p("P5","11:17","12:07"),p("P6","12:09","12:59"),p("P7","13:26","14:15")],
          7:[hr,common1,p("P2","08:40","09:30"),p("P3","09:32","10:22"),p("P4","10:49","11:39"),p("P5","11:41","12:31","P5 / Snack"),p("P6","12:34","13:24"),p("P7","13:26","14:15")],
          8:[hr,common1,p("P2","08:40","09:30"),p("P3","09:32","10:22"),p("P4","10:24","11:14"),p("P5","11:16","12:06"),p("P6","12:34","13:24"),p("P7","13:26","14:15")]
        ]
        let early = [p("HR","07:45","07:52","Homeroom"),p("P1","07:54","08:21"),p("P2","08:23","08:50"),p("P3","08:52","09:19"),p("P4","09:21","09:48"),p("P5","09:50","10:17"),p("P6","10:19","10:46"),p("P7","10:48","11:15")]
        let lunches = [5:p("LUNCH","11:17","11:39","Lunch"),6:p("LUNCH","13:01","13:23","Lunch"),7:p("LUNCH","10:24","10:46","Lunch"),8:p("LUNCH","12:09","12:31","Lunch")]
        return SchoolProfile(id:"gms",contentVersion:"2026-2027.1",displayName:"Galvin Middle School",timeZoneIdentifier:"America/New_York",cycleDayIdentifiers:["1","2","3","4","5","6"],calendarDays:calendar.days,scheduleTemplateIDs:["regular","er"],periodIdentifiers:["HR","P1","P2","P3","P4","P5","P6","P7"],lunchRules:[:],staffEvents:[],blockColors:[:],gmsRules:.init(regular:regular,earlyRelease:early,lunchByGrade:lunches,winPeriodByGrade:[5:"P1",6:"P7",7:"P1",8:"P1"],specialistPeriodsByGrade:[5:["P4","P7"],6:["P1","P5"],7:["P3","P6"],8:["P2","P6"]]),gmsGrade:nil,genericDefinition:nil,schedule:empty,calendar:calendar)
    }
