document.getElementById('logout')?.addEventListener('click', async () => {
    const csrf = document.querySelector('meta[name="csrf-token"]').content;
    await fetch('/api/logout', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrf },
    });
    location.href = '/login';
});