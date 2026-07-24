(function () {
  'use strict';
  var history = [];
  var busy = false;
  var chat = document.getElementById('ai-chat');
  var scrollBox = document.getElementById('ai-scroll') || chat;
  var form = document.getElementById('ai-form');
  var input = document.getElementById('ai-input');
  var send = document.getElementById('ai-send');

  function scrollChatToEnd() {
    if (!scrollBox) return;
    scrollBox.scrollTop = scrollBox.scrollHeight;
  }

  function resizeInput() {
    if (!input) return;
    input.style.height = '0px';
    // বাংলা গ্লিফের নিচের অংশ কেটে না যায় — ছোট বাফার
    var next = Math.min(Math.max(44, input.scrollHeight + 6), 120);
    input.style.height = next + 'px';
    input.style.overflowY = next >= 120 ? 'auto' : 'hidden';
  }

  function resetInput() {
    input.value = '';
    input.style.height = '';
    resizeInput();
  }

  function addMessage(role, text, extraClass) {
    var el = document.createElement('div');
    el.className = 'ai-msg ai-msg--' + role + (extraClass ? ' ' + extraClass : '');
    el.textContent = text;
    chat.appendChild(el);
    scrollChatToEnd();
    return el;
  }
  function addTyping() {
    var el = document.createElement('div');
    el.className = 'ai-msg ai-msg--assistant';
    el.innerHTML = '<span class="ai-typing" aria-label="উত্তর প্রস্তুত হচ্ছে"><i></i><i></i><i></i></span>';
    chat.appendChild(el);
    scrollChatToEnd();
    return el;
  }
  async function ask(text) {
    text = String(text || '').trim();
    if (!text || busy) return;
    busy = true; send.disabled = true; input.disabled = true;
    addMessage('user', text);
    var typing = addTyping();
    try {
      var response = await fetch('/api/admin-assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorId: MMSession.getAdminUserId(), pin: MMSession.getAdminPin(),
          message: text, history: history
        })
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok || !data.ok) throw new Error(data.message || 'সহকারী এখন উত্তর দিতে পারছে না।');
      typing.remove();
      addMessage('assistant', data.answer || 'কোনো উত্তর পাওয়া যায়নি।');
      history.push({ role:'user', text:text }, { role:'model', text:data.answer || '' });
      history = history.slice(-8);
    } catch (error) {
      typing.remove();
      addMessage('assistant', error.message || 'সহকারী এখন পাওয়া যাচ্ছে না।', 'ai-msg--error');
    } finally {
      busy = false; send.disabled = false; input.disabled = false; input.focus();
      resizeInput();
    }
  }
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var text = input.value;
    resetInput();
    ask(text);
  });
  input.addEventListener('input', resizeInput);
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
  });
  document.querySelectorAll('[data-ai-question]').forEach(function (button) {
    button.addEventListener('click', function () { ask(button.getAttribute('data-ai-question')); });
  });
  resizeInput();
})();

