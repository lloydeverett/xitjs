import type { DueDate } from './types.ts';

// yyyy, then optionally a separator and mm[sep dd] | Www | Qq, with the same
// separator throughout (the \2 backreference).
const PATTERN = /^(\d{4})(?:([-/])(?:(\d{2})(?:\2(\d{2}))?|W(\d{2})|Q(\d)))?$/;

/**
 * Parses a due date pattern, without the `-> ` prefix: `2022-03-31`,
 * `2022/03`, `2022`, `2022-W09` or `2022/Q1`. Returns `null` unless the
 * whole string is a valid pattern for a date that exists.
 */
export function parseDueDate(text: string): DueDate | null {
  const match = PATTERN.exec(text);
  if (!match) return null;
  const [, y, , m, d, w, q] = match;
  const year = Number(y);

  if (w !== undefined) {
    const week = Number(w);
    if (week < 1 || week > weeksInYear(year)) return null;
    const date = formatDays(isoWeekMonday(year, week) + 6);
    return date === null ? null : { text, period: 'week', year, week, date };
  }
  if (q !== undefined) {
    const quarter = Number(q);
    if (quarter < 1 || quarter > 4) return null;
    const month = quarter * 3;
    return { text, period: 'quarter', year, quarter, date: format(year, month, daysInMonth(year, month)) };
  }
  if (m === undefined) {
    return { text, period: 'year', year, date: format(year, 12, 31) };
  }
  const month = Number(m);
  if (month < 1 || month > 12) return null;
  if (d === undefined) {
    return { text, period: 'month', year, month, date: format(year, month, daysInMonth(year, month)) };
  }
  const day = Number(d);
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { text, period: 'day', year, month, day, date: format(year, month, day) };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

// Days since 1970-01-01 in the proleptic Gregorian calendar, and back again
// (Howard Hinnant's algorithms: http://howardhinnant.github.io/date_algorithms.html).
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(days: number): [year: number, month: number, day: number] {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (month <= 2 ? 1 : 0), month, day];
}

/** 1 for Monday to 7 for Sunday. 1970-01-01 was a Thursday. */
function isoWeekday(days: number): number {
  return ((((days + 3) % 7) + 7) % 7) + 1;
}

/** An ISO year has 53 weeks if it starts on a Thursday, or on a Wednesday in a leap year. */
function weeksInYear(year: number): number {
  const jan1 = isoWeekday(daysFromCivil(year, 1, 1));
  return jan1 === 4 || (jan1 === 3 && isLeapYear(year)) ? 53 : 52;
}

/** Week 1 is the week with 4 January in it. */
function isoWeekMonday(year: number, week: number): number {
  const jan4 = daysFromCivil(year, 1, 4);
  return jan4 - (isoWeekday(jan4) - 1) + (week - 1) * 7;
}

function formatDays(days: number): string | null {
  const [year, month, day] = civilFromDays(days);
  return year > 9999 ? null : format(year, month, day);
}

function format(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
