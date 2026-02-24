// FORGE Dashboard — F3: Trade Drill-Down Modal

FORGE.openTradeModal = function(agentName, tradeIndex) {
    const trades = FORGE.state.closedTradesCache[agentName];
    if (!trades || !trades[tradeIndex]) return;

    const t = trades[tradeIndex];
    const et = t.entryTechnicals || {};
    const fm = t.forgeMetadata || {};
    const holdDays = t.holdTime ? Math.round(t.holdTime / 86400000) : '--';
    const plClass = t.profitLoss >= 0 ? 'positive' : 'negative';
    const plSign = t.profitLoss >= 0 ? '+' : '';

    let html = `
    <div class="modal-header">
        <h2>${t.symbol} <span class="${plClass}" style="font-size:16px">${plSign}$${t.profitLoss?.toFixed(2)} (${plSign}${t.returnPercent?.toFixed(1)}%)</span></h2>
        <div style="color:var(--text-secondary);font-size:12px;margin-top:4px">
            ${t.agent || agentName} &middot; ${t.sector || 'Unknown'} &middot; Held ${holdDays}d
        </div>
    </div>

    <div class="modal-section">
        <h4>Entry Technicals</h4>
        <div class="modal-grid">
            ${gridItem('Momentum', et.momentumScore)}
            ${gridItem('RS Score', et.rsScore)}
            ${gridItem('RSI', et.rsi != null ? Math.round(et.rsi) : null)}
            ${gridItem('MACD Cross', et.macdCrossover)}
            ${gridItem('Structure', et.structure)}
            ${gridItem('Structure Score', et.structureScore)}
            ${gridItem('BOS', et.bos ? (et.bosType || 'Yes') : 'No')}
            ${gridItem('CHoCH', et.choch ? (et.chochType || 'Yes') : 'No')}
            ${gridItem('Sweep', et.sweep || 'None')}
            ${gridItem('Composite', et.compositeScore)}
            ${gridItem('VIX', et.vixLevel)}
            ${gridItem('5d Return', et.totalReturn5d != null ? et.totalReturn5d.toFixed(1) + '%' : null)}
        </div>
    </div>

    <div class="modal-section">
        <h4>Entry Context</h4>
        <div class="modal-grid">
            ${gridItem('Conviction', t.entryConviction ? t.entryConviction + '/10' : null)}
            ${gridItem('Entry Price', t.buyPrice ? '$' + t.buyPrice.toFixed(2) : null)}
            ${gridItem('Entry Date', t.buyDate ? new Date(t.buyDate).toLocaleDateString() : null)}
            ${gridItem('Regime', t.exitMarketRegime || 'Unknown')}
        </div>
    </div>`;

    if (fm.decisionFrameworkUsed) {
        html += `
    <div class="modal-section">
        <h4>Decision Framework</h4>
        <div class="modal-text">${fm.decisionFrameworkUsed}</div>
    </div>`;
    }

    html += `
    <div class="modal-section">
        <h4>Thesis Qualification</h4>
        <div class="modal-grid">
            ${gridItem('Qualified', fm.thesisQualified === true ? '<span class="badge badge-green">YES</span>' : fm.thesisQualified === false ? '<span class="badge badge-red">NO</span>' : '<span class="badge badge-gray">--</span>', true)}
        </div>
        ${fm.thesisAdherenceNotes ? `<div class="modal-text" style="margin-top:8px">${fm.thesisAdherenceNotes}</div>` : ''}
    </div>

    <div class="modal-section">
        <h4>Exit</h4>
        <div class="modal-grid">
            ${gridItem('Exit Reason', t.exitReason ? `<span class="badge badge-${t.exitReason}">${t.exitReason.replace(/_/g, ' ')}</span>` : null, true)}
            ${gridItem('Exit Price', t.sellPrice ? '$' + t.sellPrice.toFixed(2) : null)}
            ${gridItem('Exit Date', t.sellDate ? new Date(t.sellDate).toLocaleDateString() : null)}
            ${gridItem('Exit Conviction', t.exitConviction ? t.exitConviction + '/10' : null)}
        </div>
        ${t.exitReasoning ? `<div class="modal-text" style="margin-top:8px">${t.exitReasoning}</div>` : ''}
    </div>`;

    document.getElementById('trade-modal-body').innerHTML = html;
    document.getElementById('trade-modal').style.display = '';
};

FORGE.closeTradeModal = function() {
    document.getElementById('trade-modal').style.display = 'none';
};

// Close on Escape
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') FORGE.closeTradeModal();
});

function gridItem(label, value, isHtml) {
    const display = value != null ? (isHtml ? value : escapeHtml(String(value))) : '<span style="color:var(--text-muted)">--</span>';
    return `<div class="modal-grid-item"><div class="label">${label}</div><div class="value">${display}</div></div>`;
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
