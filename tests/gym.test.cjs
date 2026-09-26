const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'тренировки-v2.html'), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

// Test the actual inline app and delegated handlers without a browser or dependencies.
function app(seed = {}) {
  const storage = new Map(Object.entries(seed));
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      innerHTML: '', textContent: '', clientWidth: 390, style: {},
      parentElement: { style: {} }, classList: { toggle() {} }, handlers: {},
      addEventListener(event, handler) { this.handlers[event] = handler; }
    });
    return elements.get(id);
  }
  const alerts = [];
  const context = vm.createContext({
    document: { getElementById: element, querySelector: () => null },
    window: { scrollTo() {}, addEventListener() {} },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    alert: s => alerts.push(s), confirm: () => true,
    setInterval: () => 1, clearInterval() {}, console, Date, Blob, URL
  });
  vm.runInContext(script, context);
  const run = code => vm.runInContext(code, context);
  const input = (dataset, value, id = '') => element('view').handlers.input({ target: { dataset, value, id } });
  const click = (kind, dataset) => {
    const target = {
      dataset, classList: { toggle() {} }, setAttribute() {},
      matches: selector => kind === 'chk' && selector === '.chk',
      hasAttribute: name => name === 'data-' + kind,
      closest: selector => selector === '.card' ? { classList: { toggle() {} } } : target
    };
    element('view').handlers.click({ target });
  };
  return { run, storage, alerts, input, click, element };
}

test('every tab and all three workout days render', () => {
  const a = app();
  for (const tab of ['today', 'program', 'body', 'spine', 'progress', 'history', 'why']) {
    a.run(`S.tab=${JSON.stringify(tab)};render()`);
    assert.ok(a.element('view').innerHTML.length > 100, tab);
  }
  for (let day = 1; day <= 3; day++) {
    a.run(`S.tab='today';S.day=${day};render()`);
    assert.equal((a.element('view').innerHTML.match(/data-addset/g) || []).length, 6);
    assert.doesNotMatch(a.element('view').innerHTML, /undefined|NaN/);
  }
});

test('decimal comma, lb, added sets and compound sets survive reload and save', () => {
  let a = app();
  a.input({f:'w', i:'0', j:'0', k:'0'}, '40,5');
  a.input({f:'r', i:'0', j:'0', k:'0'}, '8');
  a.click('addseg', {i:'0', j:'0'});
  a.input({f:'w', i:'0', j:'0', k:'1'}, '70.5');
  a.input({f:'unit', i:'0', j:'0', k:'1'}, 'lb');
  a.input({f:'r', i:'0', j:'0', k:'1'}, '4');
  a.click('addset', {i:'0'});
  assert.equal(a.run('counts().total'), 17);
  a.click('chk', {i:'0', j:'0'});
  assert.equal(a.run('counts().done'), 1);
  a = app(Object.fromEntries(a.storage));
  assert.equal(a.run('currentLog().sets[0].length'), 4);
  assert.equal(a.run('currentLog().sets[0][0].segments[0].w'), '40,5');
  a.run('saveSession()');
  assert.equal(a.run('S.day'), 2);
  assert.equal(a.run('S.custom[0].detail[0][1].length'), 1);
  assert.equal(a.run('S.custom[0].detail[0][1][0][1].unit'), 'lb');
  assert.equal(a.run('S.custom[0].e[0][1][1][0]'), 31.98);
  assert.match(a.run('renderHistory()'), /40.5 kg × 8 → 70.5 lb × 4/);
  assert.equal(a.run('tonnage(S.custom[0])'), 452);
});

test('incomplete, negative and fractional-rep entries cannot be saved', () => {
  const a = app();
  a.click('chk', {i:'0', j:'0'});
  a.run('saveSession()');
  assert.equal(a.run('S.custom.length'), 0);
  assert.equal(a.run('S.day'), 1);
  for (const [weight, reps] of [['-1','8'], ['abc','8'], ['20','2.5'], ['20','0']]) {
    a.input({f:'w',i:'0',j:'0',k:'0'},weight);
    a.input({f:'r',i:'0',j:'0',k:'0'},reps);
    a.run('saveSession()');
    assert.equal(a.run('S.custom.length'), 0);
  }
  a.input({f:'w',i:'0',j:'0',k:'0'},'0');
  a.input({f:'r',i:'0',j:'0',k:'0'},'8');
  a.run('saveSession()');
  assert.equal(a.run('S.custom.length'), 1);
});

test('cycle advances A → Б → В → A without eight-week limit', () => {
  const a = app();
  a.run('S.week=12');
  for (const expected of [2,3,1]) {
    a.run("constForTest=rowsFor(currentLog(),0,DAYS[S.day-1].ex[0]);constForTest[0]={done:true,segments:[{w:20,r:8,unit:'kg'}]};saveSession()");
    assert.equal(a.run('S.day'), expected);
  }
  assert.equal(a.run('S.week'), 13);
  assert.equal(a.run('S.custom.length'), 3);
});

test('unit defaults do not reinterpret filled weights; exercise changes do not relabel entries', () => {
  const a = app();
  a.input({f:'w',i:'0',j:'0',k:'0'}, '27,5');
  a.input({}, 'lb', 'selunit');
  assert.equal(a.run('currentLog().sets[0][0].segments[0].unit'), 'kg');
  assert.equal(a.run('currentLog().sets[0][1].segments[0].unit'), 'lb');
  a.input({choice:'0'}, 'Маятниковый присед');
  assert.equal(a.run('currentLog().names[0]'), 'Гакк-присед');
  a.input({choice:'3'}, 'Отжимания от лавки');
  assert.equal(a.run('currentLog().names[3]'), 'Отжимания от лавки');
});

test('old history, measurements and unfinished log are retained once, outside new workout indices', () => {
  const old = {week:7, day:2, body:[{d:'2026-09-26',w:70}], daily:{'2026-09-26':1},
    custom:[{d:'2026-09-25',k:'w1d1',e:[['Присед',[[80,6]]]]}],
    log:{w7d2:{sets:{0:[{w:190,r:8,done:true}]}}}};
  let a = app({'train-v2':JSON.stringify(old)});
  assert.equal(a.run('S.week'), 1);
  assert.equal(a.run('S.custom[0].k'), 'legacy:w1d1');
  assert.equal(a.run('S.body[0].w'), 70);
  assert.equal(a.run('S.legacyLog.w7d2.sets[0][0].w'), 190);
  assert.match(a.run('renderHistory()'), /Черновики старой программы/);
  assert.match(a.run('renderLegacyDrafts()'), /Хип-траст/);
  assert.equal(a.run('currentLog().sets[0][0].segments[0].w'), undefined);
  a.run('save()');
  a = app(Object.fromEntries(a.storage));
  assert.equal(a.run('S.custom.length'), 1);
  assert.equal(a.storage.get('train-v2'), JSON.stringify(old));
});

test('different machines remain distinct and assisted pullups are excluded from tonnage', () => {
  const a = app();
  assert.notEqual(a.run("canon('Сгибание ног сидя')"), a.run("canon('Сгибание ног лёжа')"));
  assert.notEqual(a.run("canon('Ягодичный мост в Смите')"), a.run("canon('Хип-траст')"));
  assert.equal(a.run("tonnage({e:[['Подтягивания в гравитроне',[[20,10]]]]})"), 0);
  a.run("S.custom=[{d:'2026-09-26',e:[['Подтягивания в гравитроне',[[30,8],[20,6]]]]}]");
  assert.equal(a.run("series('Подтягивания в гравитроне','e1rm').at(-1).v"), 20);
});

test('removing added sets and segments keeps the remaining entries and counts', () => {
  const a = app();
  a.click('addset', {i:'0'});
  a.input({f:'w',i:'0',j:'3',k:'0'}, '50');
  a.click('delset', {i:'0',j:'3'});
  assert.equal(a.run('counts().total'), 16);
  a.input({f:'w',i:'0',j:'0',k:'0'}, '40');
  a.click('addseg', {i:'0',j:'0'});
  a.input({f:'w',i:'0',j:'0',k:'1'}, '35');
  a.click('delseg', {i:'0',j:'0',k:'1'});
  assert.equal(a.run('currentLog().sets[0][0].segments.length'), 1);
  assert.equal(a.run('currentLog().sets[0][0].segments[0].w'), '40');
});

test('storage failure does not advance the workout or report a saved session', () => {
  const a = app();
  a.run("currentLog().sets[0][0]={done:true,segments:[{w:20,r:8,unit:'kg'}]};localStorage.setItem=()=>{throw Error('quota')};saveSession()");
  assert.equal(a.run('S.day'), 1);
  assert.equal(a.run('S.custom.length'), 0);
  assert.match(a.alerts.at(-1), /Не удалось сохранить/);
});

test('body measurements retain composition fields on reload and same-date updates', () => {
  let a = app();
  a.run("BODY_FIELDS.forEach(([key])=>document.getElementById('b_'+key).value='');document.getElementById('bd').value='2025-01-10';document.getElementById('bsource').value='InBody'");
  for (const [key,value] of Object.entries({w:'80',m:'30,2',f:'20',fm:'16',ffm:'64',water:'40',score:'85'})) a.element('b_'+key).value=value;
  a.run('saveBodyMeasurement()');
  a=app(Object.fromEntries(a.storage));
  assert.equal(a.run("S.body.find(x=>x.d==='2025-01-10').m"),30.2);
  assert.match(a.run('renderBody()'),/История состава тела/);
  assert.match(a.run('renderBody()'),/Мышечная масса/);
  a.run("BODY_FIELDS.forEach(([key])=>document.getElementById('b_'+key).value='');document.getElementById('bd').value='2025-01-10';document.getElementById('bsource').value='InBody';document.getElementById('b_t').value='75';saveBodyMeasurement()");
  assert.equal(a.run("S.body.filter(x=>x.d==='2025-01-10').length"),1);
  assert.equal(a.run("S.body.find(x=>x.d==='2025-01-10').m"),30.2);
  assert.equal(a.run("S.body.find(x=>x.d==='2025-01-10').t"),75);
  a.element('b_f').value='120';a.run('saveBodyMeasurement()');
  assert.equal(a.run("S.body.find(x=>x.d==='2025-01-10').f"),20);
});
