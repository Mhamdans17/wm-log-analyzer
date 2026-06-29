const testerForm = document.getElementById('testerForm');
const runBtn = document.getElementById('runBtn');
const btnText = document.getElementById('btnText');
const btnLoader = document.getElementById('btnLoader');
const logContainer = document.getElementById('logContainer');
const reportSummary = document.getElementById('reportSummary');
const passReqEl = document.getElementById('passReq');
const failReqEl = document.getElementById('failReq');
const totalReqEl = document.getElementById('totalReq');

function showModal(title, message, isConfirm = false, onConfirm = null) {
    const modal = document.getElementById('brutalistModal');
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMessage').textContent = message;
    
    const cancelBtn = document.getElementById('modalCancelBtn');
    const okBtn = document.getElementById('modalOkBtn');
    
    if (isConfirm) {
        cancelBtn.style.display = 'inline-block';
        okBtn.textContent = 'Ya, Hapus';
        okBtn.style.background = 'var(--error)';
        okBtn.style.color = '#fff';
    } else {
        cancelBtn.style.display = 'none';
        okBtn.textContent = 'OK';
        okBtn.style.background = 'var(--primary)';
        okBtn.style.color = '#000';
    }
    
    modal.style.display = 'flex';
    
    const newOkBtn = okBtn.cloneNode(true);
    okBtn.replaceWith(newOkBtn);
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.replaceWith(newCancelBtn);
    
    const hideModal = () => { modal.style.display = 'none'; };
    
    newCancelBtn.addEventListener('click', hideModal);
    newOkBtn.addEventListener('click', () => {
        hideModal();
        if (onConfirm) onConfirm();
    });
}


testerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const collectionFile = document.getElementById('collectionFile').files[0];
    const dataFile = document.getElementById('dataFile').files[0];
    const baseUrl = document.getElementById('baseUrl').value;
    const expectedJsonField = document.getElementById('expectedJsonField').value;
    const expectedJsonValue = document.getElementById('expectedJsonValue').value;

    if (!collectionFile) {
        showModal('Perhatian', 'Harap unggah file Postman Collection (.json).');
        return;
    }

    // Set UI to loading state
    runBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoader.style.display = 'block';
    
    logContainer.innerHTML = '<div class="log-line sev-I"><span class="log-facility">[Newman]</span><span class="log-msg">Starting execution... Please wait.</span></div>';
    reportSummary.style.display = 'none';
    const reportActionContainer = document.getElementById('reportActionContainer');
    if (reportActionContainer) reportActionContainer.style.display = 'none';

    const formData = new FormData();
    formData.append('collection', collectionFile);
    if (dataFile) formData.append('data', dataFile);
    if (baseUrl) formData.append('baseUrl', baseUrl);
    if (expectedJsonField) formData.append('expectedJsonField', expectedJsonField);
    if (expectedJsonValue) formData.append('expectedJsonValue', expectedJsonValue);

    try {
        const response = await fetch('/api/newman/run', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        
        if (response.ok) {
            renderResults(result);
        } else {
            renderError(result.error || 'An error occurred during execution.');
        }
    } catch (err) {
        renderError('Failed to connect to the server. ' + err.message);
    } finally {
        runBtn.disabled = false;
        btnText.style.display = 'block';
        btnLoader.style.display = 'none';
    }
});

function renderResults(result) {
    reportSummary.style.display = 'flex';
    const totalAssertions = result.summary.assertions && result.summary.assertions.total ? result.summary.assertions.total : 0;
    const failedAssertions = result.summary.assertions && result.summary.assertions.failed ? result.summary.assertions.failed : 0;
    const passedAssertions = totalAssertions - failedAssertions;
    const totalRequests = result.summary.requests && result.summary.requests.total ? result.summary.requests.total : 0;

    passReqEl.textContent = passedAssertions;
    failReqEl.textContent = failedAssertions;
    totalReqEl.textContent = totalRequests;

    const reportActionContainer = document.getElementById('reportActionContainer');
    const viewReportBtn = document.getElementById('viewReportBtn');
    if (result.reportUrl && reportActionContainer && viewReportBtn) {
        viewReportBtn.href = result.reportUrl;
        viewReportBtn.style.display = 'inline-flex';
        reportActionContainer.style.display = 'flex';
    }

    logContainer.innerHTML = '';
    
    // Render each execution
    if (result.executions && result.executions.length > 0) {
        result.executions.forEach(exec => {
            const isFailed = exec.assertions.some(a => a.error);
            const sevClass = isFailed ? 'sev-E' : 'sev-I';
            const logClass = isFailed ? 'failed' : 'success';
            const statusText = isFailed ? '[FAILED]' : '[OK]';
            const responseCode = exec.responseCode ? `(HTTP ${exec.responseCode})` : '';

            let assertionsHtml = '';
            if (exec.assertions && exec.assertions.length > 0) {
                assertionsHtml = `<div style="margin-top: 5px; font-size: 0.8rem;">`;
                exec.assertions.forEach(a => {
                    const color = a.error ? 'var(--error)' : '#22c55e';
                    const icon = a.error ? '✖' : '✔';
                    assertionsHtml += `<div style="color: ${color}; margin-left: 10px;">${icon} ${a.name}</div>`;
                });
                assertionsHtml += `</div>`;
            }

            const div = document.createElement('div');
            div.className = `log-line ${sevClass}`;
            div.innerHTML = `
                <span class="log-facility" style="color: ${isFailed ? 'var(--error)' : '#22c55e'}">${statusText}</span>
                <span class="log-msg" style="flex: 1;">
                    <strong>${exec.name}</strong> ${responseCode}
                    ${assertionsHtml}
                </span>
            `;
            logContainer.appendChild(div);
        });
    } else {
        const div = document.createElement('div');
        div.className = 'log-line sev-I';
        div.innerHTML = `<span class="log-facility">[Newman]</span><span class="log-msg">Completed with no specific execution details. Check console for output.</span>`;
        logContainer.appendChild(div);
    }

    // Scroll to bottom
    setTimeout(() => {
        const terminalBody = document.querySelector('.terminal-body');
        if (terminalBody) terminalBody.scrollTop = terminalBody.scrollHeight;
    }, 10);
}

function renderError(errorMsg) {
    logContainer.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'log-line sev-E';
    div.innerHTML = `<span class="log-facility">[ERROR]</span><span class="log-msg">${errorMsg}</span>`;
    logContainer.appendChild(div);
}

// Ensure container is visible but the specific report button is hidden on load
document.addEventListener('DOMContentLoaded', () => {
    const actionContainer = document.getElementById('reportActionContainer');
    if (actionContainer) actionContainer.style.display = 'flex';
    const viewReportBtn = document.getElementById('viewReportBtn');
    if (viewReportBtn) viewReportBtn.style.display = 'none';
});

document.getElementById('clearReportBtn').addEventListener('click', () => {
    showModal("Konfirmasi", "Hapus SEMUA file report (.html) dari server?", true, async () => {
        try {
            await fetch('/api/newman/reports', { method: 'DELETE' });
            document.getElementById('reportSummary').style.display = 'none';
            document.getElementById('viewReportBtn').style.display = 'none';
            document.getElementById('logContainer').innerHTML = '<div class="log-line sev-I" style="justify-content: center; margin-top: 2rem;"><span class="log-msg" style="color: var(--text-muted);">Upload a collection and click Run to see results here.</span></div>';
            showModal("Berhasil", "Semua report berhasil dihapus!");
        } catch (e) {
            console.error(e);
            showModal("Error", "Gagal menghapus report.");
        }
    });
});

document.getElementById('viewDataListBtn').addEventListener('click', async () => {
    try {
        const res = await fetch('/api/newman/reports');
        const files = await res.json();
        const listItems = document.getElementById('reportsListItems');
        listItems.innerHTML = '';
        if (files.length === 0) {
            listItems.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem;">Belum ada report yang tersimpan.</div>';
        } else {
            files.forEach(f => {
                let dateStr = f;
                try {
                    const ts = parseInt(f.replace('report-', '').replace('.html', ''));
                    dateStr = new Date(ts).toLocaleString();
                } catch(e) {}
                
                listItems.innerHTML += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.4rem 0.8rem; background: #fff; border: 1px solid var(--border-color);">
                        <span style="font-size: 0.85rem; font-weight: 500;">${dateStr}</span>
                        <a href="/reports/${f}" target="_blank" class="pill-btn outline" style="padding: 0.3rem 0.8rem; font-size: 0.75rem; text-decoration: none;">Buka</a>
                    </div>
                `;
            });
        }
        document.getElementById('reportsListContainer').style.display = 'flex';
    } catch (e) {
        console.error(e);
        showModal("Error", "Gagal memuat daftar report.");
    }
});

document.getElementById('closeReportsListBtn').addEventListener('click', () => {
    document.getElementById('reportsListContainer').style.display = 'none';
});
