document.querySelectorAll('[data-logout]').forEach((btn) => {
    btn.addEventListener('click', async () => {
        await api('/api/logout', 'POST');
        location.href = '/login';
    });
});
