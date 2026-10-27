'use strict';

(function () {
  const api = window.qqpetAdopt;
  const input = document.getElementById('name');

  function submit() {
    const name = (input.value || '').trim().slice(0, 8) || '小蓝';
    api.submit({ name: name, gender: 'GG' });
  }

  document.getElementById('ok').addEventListener('click', submit);
  document.getElementById('cancel').addEventListener('click', function () { api.cancel(); });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') submit();
  });

  input.focus();
  input.select();
})();
