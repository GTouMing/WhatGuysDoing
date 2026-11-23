/* Local lesson feedback only: no network, storage, timers or project actions. */
(() => {
  const fieldsets = document.querySelectorAll('[data-quiz]');
  for (const fieldset of fieldsets) {
    const button = fieldset.querySelector('[data-check]');
    const feedback = fieldset.querySelector('[data-feedback]');
    const solution = fieldset.querySelector('[data-solution]');
    if (!button || !feedback || !solution) continue;

    button.addEventListener('click', () => {
      const selected = fieldset.querySelector('input[type="radio"]:checked');
      if (!selected) {
        feedback.textContent = '先选择一个判断，再查看反馈。';
        feedback.dataset.result = 'retry';
        return;
      }
      const correct = selected.value === fieldset.dataset.answer;
      feedback.textContent = correct
        ? `判断正确。${solution.textContent.trim()}`
        : `需要修正。${solution.textContent.trim()}`;
      feedback.dataset.result = correct ? 'correct' : 'retry';
    });
  }
})();
