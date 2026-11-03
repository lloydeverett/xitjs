import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDescription, type Segment } from '../src/index.ts';

/** A compact view of a description's segments: `#…` for tags, `->…` for the due date, `"…"` for text. */
function pieces(description: string): string[] {
  return parseDescription(description).segments.map((s: Segment) =>
    s.type === 'text' ? JSON.stringify(s.text) : `${s.type}:${s.text}`,
  );
}

function tags(description: string) {
  return parseDescription(description).tags;
}

describe('parseDescription: segments', () => {
  test('plain text is one segment, and an empty description has none', () => {
    assert.deepEqual(parseDescription('Do this'), {
      tags: [], dueDate: null, segments: [{ type: 'text', text: 'Do this' }],
    });
    assert.deepEqual(parseDescription(''), { tags: [], dueDate: null, segments: [] });
  });

  test('joining the segments gives the description back', () => {
    for (const d of ['a #b c -> 2022-01-31 d', '#x="y z"!\n-> 2022 #q', '  #a#b -> -> 2022']) {
      assert.equal(parseDescription(d).segments.map((s) => s.text).join(''), d);
    }
  });

  test('tags and the due date are their own segments', () => {
    assert.deepEqual(pieces('Do #this -> 2022-01-31 now'), [
      '"Do "', 'tag:#this', '" "', 'due-date:-> 2022-01-31', '" now"',
    ]);
  });
});

describe('parseDescription: tags', () => {
  test('a tag name is letters (any script), digits, - and _', () => {
    for (const name of ['tag', 'T-A-G', '--tag--', '__tag__', 't_a_g', '123', '___', '---', '1t2a3g',
      'täg', '今日は', 'გამარჯობა', 'σκληρά', 'ήλιο']) {
      assert.deepEqual(tags(`#${name}`), [{ name, value: null }], name);
    }
  });

  test('several tags, across lines', () => {
    assert.deepEqual(pieces('#Actually, it #has a #LOT.\nEven on the #next-line!'), [
      'tag:#Actually', '", it "', 'tag:#has', '" a "', 'tag:#LOT', '".\\nEven on the "', 'tag:#next-line', '"!"',
    ]);
  });

  test('a tag ends at the first character that is not allowed in a name', () => {
    assert.deepEqual(pieces('This is a #tag.'), ['"This is a "', 'tag:#tag', '"."']);
    assert.deepEqual(pieces('Tags: #tag1/#tag2'), ['"Tags: "', 'tag:#tag1', '"/"', 'tag:#tag2']);
    assert.deepEqual(pieces('#t-a-g!'), ['tag:#t-a-g', '"!"']);
    assert.deepEqual(pieces('#--tag--?'), ['tag:#--tag--', '"?"']);
    assert.deepEqual(pieces('#--tag--:text'), ['tag:#--tag--', '":text"']);
    assert.deepEqual(pieces('(#tag)'), ['"("', 'tag:#tag', '")"']);
    assert.deepEqual(pieces('#tag🥳'), ['tag:#tag', '"🥳"']);
  });

  test('a combining mark is not a letter, so it ends a tag (the spec says letters, Unicode L)', () => {
    assert.deepEqual(pieces('#ta\u0308g'), ['tag:#ta', '"\u0308g"']);
  });

  test('a # with no name is not a tag', () => {
    for (const d of ['Not a tag: #', 'Not a tag: #=value', 'Not a tag: #="value"', '# heading', '##']) {
      assert.deepEqual(tags(d), [], d);
    }
  });

  test('a # straight after a letter, digit, - or _ does not start a tag', () => {
    assert.deepEqual(pieces('see page#anchor'), ['"see page#anchor"']);
    assert.deepEqual(pieces('C#7'), ['"C#7"']);
    assert.deepEqual(pieces('#a#b'), ['tag:#a', '"#b"']);
    assert.deepEqual(pieces('x_#a y-#b'), ['"x_#a y-#b"']);
    // ...but straight after any other character it does.
    assert.deepEqual(pieces('é#a'), ['"é#a"']);
    assert.deepEqual(pieces('🥳#a'), ['"🥳"', 'tag:#a']);
    assert.deepEqual(pieces('#a="x"#b'), ['tag:#a="x"', 'tag:#b']);
  });

  test('a value can hold the same characters as a name', () => {
    assert.deepEqual(tags('#tag=value'), [{ name: 'tag', value: 'value' }]);
    assert.deepEqual(tags('#t-a-g=v-a-l-u-e'), [{ name: 't-a-g', value: 'v-a-l-u-e' }]);
    assert.deepEqual(tags('#国=日本'), [{ name: '国', value: '日本' }]);
    assert.deepEqual(pieces('#tag=value!'), ['tag:#tag=value', '"!"']);
  });

  test('an empty value is the same as no value', () => {
    for (const d of ['#tag=', '#tag=""', "#tag=''"]) {
      assert.deepEqual(parseDescription(d), {
        tags: [{ name: 'tag', value: null }], dueDate: null,
        segments: [{ type: 'tag', text: d, tag: { name: 'tag', value: null } }],
      }, d);
    }
    assert.deepEqual(pieces('#tag= x'), ['tag:#tag=', '" x"']);
  });

  test('a quoted value can hold anything but its quote, and ends at the closing quote', () => {
    assert.deepEqual(tags('#tag="v a l u e"'), [{ name: 'tag', value: 'v a l u e' }]);
    assert.deepEqual(tags("#tag='v!a.l?u+e'"), [{ name: 'tag', value: 'v!a.l?u+e' }]);
    assert.deepEqual(tags(`#q="it's"`), [{ name: 'q', value: "it's" }]);
    assert.deepEqual(pieces("#tag='foo'bar"), ["tag:#tag='foo'", '"bar"']);
    assert.deepEqual(pieces("#tag='foo'-bar"), ["tag:#tag='foo'", '"-bar"']);
    assert.deepEqual(pieces("#tag='foo'!!"), ["tag:#tag='foo'", '"!!"']);
    assert.deepEqual(pieces('(#tag="bar")'), ['"("', 'tag:#tag="bar"', '")"']);
  });

  test('a backslash does not escape a quote', () => {
    assert.deepEqual(pieces("#tag='It\\'s great'"), ["tag:#tag='It\\'", `"s great'"`]);
    assert.deepEqual(tags("#tag='It\\'s great'"), [{ name: 'tag', value: 'It\\' }]);
  });

  test('without its closing quote on the same line, the value is disregarded', () => {
    assert.deepEqual(pieces('#tag="v a l u e'), ['tag:#tag=', '"\\"v a l u e"']);
    assert.deepEqual(pieces(`#tag="v a l u e'`), ['tag:#tag=', `"\\"v a l u e'"`]);
    assert.deepEqual(pieces('#tag="hello\nWorld!"'), ['tag:#tag=', '"\\"hello\\nWorld!\\""']);
    assert.deepEqual(tags('#tag="hello\nWorld!"'), [{ name: 'tag', value: null }]);
  });

  test('tags in a row, with and without values', () => {
    assert.deepEqual(tags(`#tag1 #tag2='value' and #tag3="value"`), [
      { name: 'tag1', value: null },
      { name: 'tag2', value: 'value' },
      { name: 'tag3', value: 'value' },
    ]);
  });

  test('names keep their case; values are case-sensitive', () => {
    assert.deepEqual(tags('#Work=Urgent #work=urgent'), [
      { name: 'Work', value: 'Urgent' },
      { name: 'work', value: 'urgent' },
    ]);
  });
});

describe('parseDescription: due dates', () => {
  test('a due date is "-> " and a date pattern', () => {
    const { dueDate, segments } = parseDescription('Do this -> 2022-01-31');
    assert.equal(dueDate?.date, '2022-01-31');
    assert.equal(dueDate?.text, '2022-01-31');
    assert.deepEqual(segments.at(-1), { type: 'due-date', text: '-> 2022-01-31', dueDate });
    for (const d of ['-> 2022-01-31', '-> 2022-01', '-> 2022', '-> 2022-W01', '-> 2022-Q1',
      '-> 2022/01/31', '-> 2022/W01', '-> 2022/01', '-> 2022/Q1']) {
      assert.deepEqual(pieces(d), [`due-date:${d}`], d);
    }
  });

  test('anywhere in the description, including at the start of a continuation line', () => {
    assert.deepEqual(pieces('-> 2022-01-31 (something)'), ['due-date:-> 2022-01-31', '" (something)"']);
    assert.deepEqual(pieces('Do something until ...\n-> 2022-01-31'), [
      '"Do something until ...\\n"', 'due-date:-> 2022-01-31',
    ]);
  });

  test('only the first due date counts', () => {
    assert.deepEqual(pieces('-> 2022-01-31 -> 2022-02-28'), ['due-date:-> 2022-01-31', '" -> 2022-02-28"']);
    assert.equal(parseDescription('a -> 2022-01-31\nb -> 2023').dueDate?.date, '2022-01-31');
  });

  test('an invalid date is not a due date, so a later valid one counts', () => {
    assert.deepEqual(pieces('-> 2022-02-30 -> 2022-03'), ['"-> 2022-02-30 "', 'due-date:-> 2022-03']);
  });

  test('it can be surrounded by a space or punctuation other than - and /', () => {
    assert.deepEqual(pieces('Do this soon -> 2022-01-31!!!'), ['"Do this soon "', 'due-date:-> 2022-01-31', '"!!!"']);
    assert.deepEqual(pieces('Do this (-> 2022-01-31)'), ['"Do this ("', 'due-date:-> 2022-01-31', '")"']);
    assert.deepEqual(pieces('[ -> 2022'), ['"[ "', 'due-date:-> 2022']);
    assert.deepEqual(pieces('a,-> 2022.'), ['"a,"', 'due-date:-> 2022', '"."']);
    // '#' is punctuation, so the due date ends there; but straight after a digit, it doesn't start a tag.
    assert.deepEqual(pieces('-> 2022#tag'), ['due-date:-> 2022', '"#tag"']);
    assert.deepEqual(pieces('a\u00a0-> 2022\tb'), ['"a\u00a0"', 'due-date:-> 2022', '"\\tb"']);
  });

  test('anything else next to it means it is not a due date', () => {
    for (const d of ['---> 2022-01-31', 'Due-> 2022-01-31', '/-> 2022', '-> 2022-01-31very urgent',
      '-> 2022-01-31T10:00', '-> 2022-01-31-0', '-> 2022/01/31/0', '-> 2022-01/31', '-> 20221',
      '-> 2022🥳', '+-> 2022', '-> 2022+']) {
      assert.equal(parseDescription(d).dueDate, null, d);
    }
  });

  test('the prefix must be exactly a hyphen, a greater-than sign and one space', () => {
    for (const d of ['->2022-01-31', '→ 2022-01-31', '->   2022-01-31', '>2022-01-31', '- > 2022',
      '->\u00a02022', 'Do until ->\n2022-01-31']) {
      assert.equal(parseDescription(d).dueDate, null, JSON.stringify(d));
    }
  });
});
