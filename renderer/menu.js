'use strict';

(function () {
  const api = window.qqpetMenu;
  const list = document.getElementById('list');
  const head = document.getElementById('head');
  let state = null;

  function row(label, action) {
    const el = document.createElement('div');
    el.className = 'item';
    const left = document.createElement('span');
    left.textContent = label;
    el.appendChild(left);
    const a = document.createElement('span');
    a.className = 'arrow';
    a.textContent = '›';
    el.appendChild(a);
    el.addEventListener('click', function () { api.act(action); });
    return el;
  }

  function render(s) {
    state = s;
    head.textContent = s.name + ' · Lv.' + s.level;
    list.innerHTML = '';
    list.appendChild(row('宠物详情', 'panel'));
  }

  document.addEventListener('mousedown', function (e) {
    if (!e.target.closest('.menu')) api.hide();
  });

  api.get().then(render);
  if (api.onRefresh) api.onRefresh(function () { api.get().then(render); });
})();
