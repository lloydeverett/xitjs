import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDueDate } from '../src/index.ts';

describe('parseDueDate', () => {
  test('a day, with either separator', () => {
    for (const text of ['2022-03-31', '2022/03/31']) {
      assert.deepEqual(parseDueDate(text), {
        text, period: 'day', year: 2022, month: 3, day: 31, date: '2022-03-31',
      });
    }
  });

  test('a month ends on its last day', () => {
    assert.deepEqual(parseDueDate('2022-03'), {
      text: '2022-03', period: 'month', year: 2022, month: 3, date: '2022-03-31',
    });
    assert.equal(parseDueDate('2022/04')?.date, '2022-04-30');
    assert.equal(parseDueDate('2022-02')?.date, '2022-02-28');
    assert.equal(parseDueDate('2024-02')?.date, '2024-02-29');
    assert.equal(parseDueDate('1900-02')?.date, '1900-02-28');
    assert.equal(parseDueDate('2000-02')?.date, '2000-02-29');
    assert.equal(parseDueDate('2022-12')?.date, '2022-12-31');
  });

  test('a year ends on 31 December', () => {
    assert.deepEqual(parseDueDate('2022'), {
      text: '2022', period: 'year', year: 2022, date: '2022-12-31',
    });
  });

  test('a quarter ends on the last day of its third month', () => {
    assert.deepEqual(parseDueDate('2022-Q2'), {
      text: '2022-Q2', period: 'quarter', year: 2022, quarter: 2, date: '2022-06-30',
    });
    assert.equal(parseDueDate('2022/Q1')?.date, '2022-03-31');
    assert.equal(parseDueDate('2022-Q3')?.date, '2022-09-30');
    assert.equal(parseDueDate('2022-Q4')?.date, '2022-12-31');
  });

  test('an ISO 8601 week ends on its Sunday, which may be in the next year', () => {
    assert.deepEqual(parseDueDate('2022-W01'), {
      text: '2022-W01', period: 'week', year: 2022, week: 1, date: '2022-01-09',
    });
    // Expected values from Python's date.fromisocalendar(year, week, 7).
    const cases: Array<[string, string]> = [
      ['2022/W01', '2022-01-09'],
      ['2022-W52', '2023-01-01'],
      ['2019-W01', '2019-01-06'],
      ['2025-W01', '2025-01-05'],
      ['2020-W53', '2021-01-03'],
      ['2026-W53', '2027-01-03'],
      ['2004-W53', '2005-01-02'],
      ['2015-W53', '2016-01-03'],
      ['2021-W52', '2022-01-02'],
      ['9999-W51', '9999-12-26'],
    ];
    for (const [text, date] of cases) assert.equal(parseDueDate(text)?.date, date, text);
  });

  test('dates must exist in the Gregorian calendar', () => {
    for (const text of [
      '2022-00', '2022-13', '2022-00-10', '2022-01-00', '2022-01-32', '2022-04-31',
      '2022-02-29', '2023-02-29', '1900-02-29', '2100-02-29',
      '2022-Q0', '2022-Q5', '2022-W00', '2022-W54',
      // Only years whose 1 January is a Thursday (or a Wednesday, in leap years) have a week 53.
      '2021-W53', '2022-W53', '2027-W53',
      // Its Sunday would be in the year 10000, which YYYY-MM-DD can't hold.
      '9999-W52',
    ]) {
      assert.equal(parseDueDate(text), null, text);
    }
    assert.equal(parseDueDate('2024-02-29')?.date, '2024-02-29');
    assert.equal(parseDueDate('2000-02-29')?.date, '2000-02-29');
  });

  test('the year 0000 is allowed (ISO 8601 proleptic Gregorian, where it is a leap year)', () => {
    assert.equal(parseDueDate('0000')?.date, '0000-12-31');
    assert.equal(parseDueDate('0000-02-29')?.date, '0000-02-29');
  });

  test('anything but an exact pattern is not a due date', () => {
    for (const text of [
      '', ' 2022', '2022 ', '22-01-31', '20220', '2022-1-31', '2022-01-1', '2022-1',
      '2022-01/31', '2022/01-31', // separators can't be mixed
      '2022-w01', '2022-q1', '2022-W1', '2022-Q01', '2022W01', '2022Q1',
      '2022.01.31', '2022-01-31T10:00', '2022-01-31-0', '-> 2022',
      '２０２２', // digits are ASCII only
    ]) {
      assert.equal(parseDueDate(text), null, JSON.stringify(text));
    }
  });
});
