import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseCourseScope,
  detectIntent,
  normalizeText,
  parseTimeWindow,
  rankAssignments,
  rankCourses,
  similarityScore
} from "../src/router.js";

test("normalizeText removes Vietnamese diacritics and punctuation", () => {
  assert.equal(normalizeText("Tuần này: bài tập gì?"), "tuan nay bai tap gi");
});

test("detectIntent recognizes Vietnamese deadline requests", () => {
  const intents = detectIntent("@Canvas deadline tuần này, bài nào chưa nộp?");
  assert.ok(intents.includes("deadlines"));
});

test("detectIntent recognizes assignment instruction requests", () => {
  const intents = detectIntent("@Canvas đọc hướng dẫn và yêu cầu của Gold Foraging");
  assert.ok(intents.includes("assignmentDetail"));
  assert.ok(intents.includes("deadlines"));
});

test("detectIntent recognizes announcements, grades, files and modules", () => {
  assert.ok(detectIntent("có thông báo mới không").includes("announcements"));
  assert.ok(detectIntent("điểm hiện tại").includes("grades"));
  assert.ok(detectIntent("tìm lecture slides pdf").includes("files"));
  assert.ok(detectIntent("week 3 module").includes("modules"));
});

test("similarity and course ranking find a named course in a longer query", () => {
  const courses = [
    { id: 1, name: "Robot Camp", course_code: "RC2026" },
    { id: 2, name: "Statistics", course_code: "STAT" }
  ];
  const ranked = rankCourses("@Canvas Robot Camp assignments", courses);
  assert.equal(ranked[0].course.id, 1);
  assert.ok(ranked[0].score > 0.4);
  assert.ok(similarityScore("Gold Foraging instructions", "Gold Foraging") > 0.7);
});

test("assignment ranking selects Gold Foraging", () => {
  const assignments = [
    { id: 10, name: "Silver Integral" },
    { id: 11, name: "Gold Foraging Challenge" },
    { id: 12, name: "Reflection" }
  ];
  const ranked = rankAssignments("read Gold Foraging instructions", assignments);
  assert.equal(ranked[0].assignment.id, 11);
});

test("chooseCourseScope narrows when course name is explicit", () => {
  const courses = [
    { id: 1, name: "Robot Camp", course_code: "RC2026" },
    { id: 2, name: "Statistics", course_code: "STAT" }
  ];
  const scoped = chooseCourseScope("Robot Camp deadline", courses);
  assert.equal(scoped.matched, true);
  assert.equal(scoped.courses[0].id, 1);
});

test("parseTimeWindow handles today and this week", () => {
  const now = new Date("2026-09-03T12:00:00+02:00");
  const today = parseTimeWindow("hôm nay", now);
  assert.equal(today.label, "today");
  assert.equal(today.start.getHours(), 0);

  const week = parseTimeWindow("tuần này", now);
  assert.equal(week.label, "this week");
  assert.ok(week.end > week.start);
});
