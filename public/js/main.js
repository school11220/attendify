// Common Javascript utility file for Attendify

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[char]);
}

// Global Toast Notification System
window.showToast = function (message, type = 'success', actionCallback = null, actionLabel = 'Undo') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `px-4 py-3 rounded border text-xs font-black uppercase tracking-widest shadow-lg transform transition-all duration-300 ease-out -translate-y-full opacity-0 flex items-center justify-between gap-4 pointer-events-auto`;

    const safeMessage = escapeHtml(message);
    const safeActionLabel = escapeHtml(actionLabel);
    let htmlContent = `<div class="flex items-center gap-2">`;
    if (type === 'success') {
        toast.classList.add('bg-green-500/10', 'border-green-500/30', 'text-green-500');
        htmlContent += `<span class="material-symbols-outlined text-[16px]">check_circle</span> <span>${safeMessage}</span>`;
    } else if (type === 'error') {
        toast.classList.add('bg-primary/10', 'border-primary/30', 'text-primary');
        htmlContent += `<span class="material-symbols-outlined text-[16px]">error</span> <span>${safeMessage}</span>`;
    } else {
        toast.classList.add('bg-white/10', 'border-white/30', 'text-white');
        htmlContent += `<span class="material-symbols-outlined text-[16px]">info</span> <span>${safeMessage}</span>`;
    }
    htmlContent += `</div>`;

    if (actionCallback) {
        htmlContent += `<button class="action-btn px-3 py-1 bg-white/10 hover:bg-white/20 rounded border border-white/20 transition-colors text-[10px] whitespace-nowrap">${safeActionLabel}</button>`;
    }

    toast.innerHTML = htmlContent;

    if (actionCallback) {
        toast.querySelector('.action-btn').addEventListener('click', () => {
            actionCallback();
            // Immediatley dismiss toast on action
            toast.classList.remove('translate-y-0', 'opacity-100');
            toast.classList.add('-translate-y-2', 'opacity-0');
            setTimeout(() => toast.remove(), 300);
        });
    }

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.classList.remove('-translate-y-full', 'opacity-0');
        toast.classList.add('translate-y-0', 'opacity-100');
    });

    // Auto remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('translate-y-0', 'opacity-100');
        toast.classList.add('-translate-y-2', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

window.waitForClerk = async function () {
    try { return await window.attendifyAuthReady; }
    catch (_) { window.showToast('Sign-in is temporarily unavailable. Please reload.', 'error'); return null; }
};

window.getLocalDateString = function (date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

document.addEventListener('alpine:init', () => {
    // Make showToast accessible inside Alpine components easily if needed
    Alpine.store('utils', {
        toast(msg, type) { window.showToast(msg, type); }
    });
});

window.calculateWhatIf = function (subject) {
    const total = Math.max(0, Number(subject.total_classes) || 0);
    const attended = Math.max(0, Number(subject.attended_classes) || 0);

    const parsedRequirement = Number.parseFloat(subject.min_requirement_percentage);
    const req = Number.isFinite(parsedRequirement)
        ? Math.min(100, Math.max(0, parsedRequirement))
        : 75;

    if (total === 0) return { text: 'No classes', color: 'text-neutral-500 bg-white/5 border-border-color' };

    const currentPct = (attended / total) * 100;

    if (currentPct >= req) {
        if (req <= 0) return { text: 'Safe', color: 'text-green-500 bg-green-500/10 border-green-500/20' };
        const canMiss = Math.max(0, Math.floor((attended * 100 / req) - total));
        if (canMiss > 0) {
            return { text: `Safe to miss ${canMiss}`, color: 'text-green-500 bg-green-500/10 border-green-500/20' };
        } else {
            return { text: `On track`, color: 'text-orange-500 bg-orange-500/10 border-orange-500/20' };
        }
    } else {
        if (req >= 100) return { text: 'Cannot reach 100%', color: 'text-primary bg-primary/10 border-primary/20' };
        const needToAttend = Math.max(0, Math.ceil((req * total - 100 * attended) / (100 - req)));
        return { text: `Need ${needToAttend} more`, color: 'text-primary bg-primary/10 border-primary/20' };
    }
};
