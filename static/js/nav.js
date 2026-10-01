window.isMobile = () => window.matchMedia('(max-width: 700px)').matches;

document.querySelectorAll('[data-logout]').forEach((btn) => {
    btn.addEventListener('click', async () => {
        const csrf = document.querySelector('meta[name="csrf-token"]').content;
        await fetch('/api/logout', {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrf },
        });
        location.href = '/login';
    });
});