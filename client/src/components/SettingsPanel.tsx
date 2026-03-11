/**
 * SettingsPanel — Connection, server info, preferences, commands, quota
 * Ported from public/mobile-components/panels/settings.html + public/js/mobile/settings.js
 */
import { useState, useEffect, useCallback } from 'preact/hooks';
import { authFetch, getServerUrl } from '../hooks/useApi';
import { useApp } from '../context/AppContext';
import { useTheme } from '../hooks/useTheme';
import { useTranslation } from '../i18n';
import type { Language } from '../i18n/types';

import { Zap, Timer, Trash2, RefreshCw, Settings, Check, XCircle, Shield } from 'lucide-preact';
import { OrnamentWrapper } from './OrnamentWrapper';

// ─── Types ──────────────────────────────────────────────────────────
interface QuotaModel {
    name: string;
    remainingPercent: number;
    status: 'healthy' | 'warning' | 'danger' | 'exhausted';
    resetIn?: string;
    resetAt?: number;
}

interface QuotaData {
    available: boolean;
    models: QuotaModel[];
    error?: string;
}

interface CommandItem {
    label: string;
    prompt: string;
    icon?: string;
}

interface ServerInfo {
    version?: string;
    uptime?: string;
    lanIP?: string;
    memory?: { rss?: string } | string;
    node?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────
function formatModelName(name: string): string {
    if (!name) return 'Unknown';
    return name
        .replace(/^MODEL_/, '')
        .replace(/_/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
        .substring(0, 20);
}

const STATUS_COLORS: Record<string, { stroke: string; text: string; badge: string }> = {
    healthy: { stroke: 'var(--success)', text: 'text-[var(--success)]', badge: 'bg-[rgba(34,197,94,0.15)] text-[var(--success)]' },
    warning: { stroke: 'var(--warning)', text: 'text-[var(--warning)]', badge: 'bg-[rgba(234,179,8,0.15)] text-[var(--warning)]' },
    danger: { stroke: 'var(--error)', text: 'text-[var(--error)]', badge: 'bg-[rgba(239,68,68,0.15)] text-[var(--error)]' },
    exhausted: { stroke: 'var(--error)', text: 'text-[var(--error)]', badge: 'bg-[rgba(239,68,68,0.15)] text-[var(--error)]' },
};

// ─── Reusable sub-components ────────────────────────────────────────
function Section({ children }: { children: preact.ComponentChildren }) {
    return <div className="mb-5">{children}</div>;
}

function SectionTitle({ children }: { children: preact.ComponentChildren }) {
    return (
        <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2.5 pl-1 flex items-center gap-1.5">
            {children}
        </div>
    );
}

function SettingRow({ children, onClick, className = '' }: { children: preact.ComponentChildren; onClick?: () => void; className?: string }) {
    return (
        <div
            className={`flex justify-between items-center py-3.5 border-b border-[var(--border)] last:border-b-0 ${onClick ? 'cursor-pointer' : ''} ${className}`}
            onClick={onClick}
        >
            {children}
        </div>
    );
}

function SettingLabel({ title, subtitle }: { title: string; subtitle?: string }) {
    return (
        <div>
            <h4 className="text-sm font-medium">{title}</h4>
            {subtitle && <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
        </div>
    );
}

function SettingValue({ children, className = '' }: { children: preact.ComponentChildren; className?: string }) {
    return (
        <div className={`text-[13px] px-3 py-1.5 bg-[var(--bg-glass)] rounded-lg text-[var(--accent-primary)] font-mono ${className}`}>
            {children}
        </div>
    );
}

// ─── SettingsPanel Component ────────────────────────────────────────
export function SettingsPanel() {
    const { showToast, connected, mobileUI, updateMobileSettings } = useApp();
    const { setTheme, THEMES } = useTheme();
    const { t, lang, setLang } = useTranslation();
    const [currentTheme, setCurrentTheme] = useState(localStorage.getItem('theme') || 'command');


    // CDP status
    const [cdpStatus, setCdpStatus] = useState<'active' | 'offline' | 'error'>('offline');

    // Server info
    const [serverInfo, setServerInfo] = useState<ServerInfo>({});

    // Quota
    const [quotaData, setQuotaData] = useState<QuotaData | null>(null);
    const [quotaLoading, setQuotaLoading] = useState(false);

    // Commands
    const [commands, setCommands] = useState<CommandItem[]>([]);
    const [commandStatuses, setCommandStatuses] = useState<Record<number, string>>({});

    // Scroll Sync
    const { scrollSyncRef, toggleScrollSync } = useApp();

    // ─── Load all settings ──────────────────────────────────────────
    const loadSettings = useCallback(async () => {
        const serverUrl = getServerUrl();

        // CDP status
        try {
            const res = await authFetch(`${serverUrl}/api/cdp/status`);
            const data = await res.json();
            setCdpStatus(data.available ? 'active' : 'offline');
        } catch (_e) {
            setCdpStatus('error');
        }

        // Server info
        try {
            const statusRes = await authFetch(`${serverUrl}/api/status`);
            const info: ServerInfo = await statusRes.json();
            setServerInfo(info);
        } catch (_e) { /* silent */ }

        // Commands
        try {
            const res = await authFetch('/api/admin/commands');
            const data = await res.json();
            setCommands(data.commands || []);
        } catch (_e) { /* silent */ }

        // Quota
        loadQuota();
    }, []);

    const loadQuota = useCallback(async () => {
        if (quotaLoading) return;
        setQuotaLoading(true);
        try {
            const res = await authFetch(`${getServerUrl()}/api/quota`);
            const data: QuotaData = await res.json();
            setQuotaData(data);
        } catch (_e) {
            setQuotaData({ available: false, models: [], error: 'Failed to load quota' });
        }
        setQuotaLoading(false);
    }, [quotaLoading]);

    const executeCommand = useCallback(async (index: number, prompt: string) => {
        setCommandStatuses(prev => ({ ...prev, [index]: '⏳' }));
        try {
            const res = await authFetch('/api/commands/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt }),
            });
            const result = await res.json();
            setCommandStatuses(prev => ({ ...prev, [index]: result.success ? '✅' : '❌' }));
            setTimeout(() => setCommandStatuses(prev => ({ ...prev, [index]: '▶' })), 3000);
        } catch (_e) {
            setCommandStatuses(prev => ({ ...prev, [index]: '❌' }));
            setTimeout(() => setCommandStatuses(prev => ({ ...prev, [index]: '▶' })), 3000);
        }
    }, []);

    // Load on mount
    useEffect(() => { loadSettings(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <OrnamentWrapper 
            title={t('mobile.nav.settings')} 
            icon={<Settings size={14} />}
            className="flex-1 min-h-0 m-2"
            containerClass="overflow-y-auto"
        >
            <div className="p-4">
            {/* Connection */}
            <Section>
                <SectionTitle><Settings size={14} /> {t('mobile.settings.connection')}</SectionTitle>
                <div className="card">
                    <SettingRow>
                        <SettingLabel title={t('mobile.settings.cdpProtocol')} subtitle={t('mobile.settings.cdpSubtitle')} />
                        <SettingValue className={cdpStatus === 'active' ? 'text-[var(--success,#a6e3a1)]' : 'text-[var(--error,#f38ba8)]'}>
                            {cdpStatus === 'active'
                                ? <><Check size={14} className="inline" /> {t('mobile.common.connected')}</>
                                : cdpStatus === 'offline'
                                    ? <><XCircle size={14} className="inline" /> {t('mobile.common.offline')}</>
                                    : <><XCircle size={14} className="inline" /> {t('mobile.common.error')}</>}
                        </SettingValue>
                    </SettingRow>
                    <SettingRow>
                        <SettingLabel title={t('mobile.settings.webSocket')} subtitle={t('mobile.settings.wsSubtitle')} />
                        <SettingValue className={connected ? 'text-[var(--success,#a6e3a1)]' : 'text-[var(--error,#f38ba8)]'}>
                            {connected
                                ? <><Check size={14} className="inline" /> {t('mobile.common.connected')}</>
                                : <><XCircle size={14} className="inline" /> {t('mobile.common.disconnected')}</>}
                        </SettingValue>
                    </SettingRow>
                </div>
            </Section>

            {/* Server Info */}
            <Section>
                <SectionTitle>{t('mobile.settings.serverInfo')}</SectionTitle>
                <div className="card">
                    {([
                        [t('mobile.settings.version'), serverInfo.version],
                        [t('mobile.settings.uptime'), serverInfo.uptime],
                        [t('mobile.settings.lanIP'), serverInfo.lanIP],
                        [t('mobile.settings.memory'), typeof serverInfo.memory === 'object' ? serverInfo.memory?.rss : serverInfo.memory],
                        [t('mobile.settings.nodeJs'), serverInfo.node],
                    ] as [string, string | undefined][]).map(([label, value]) => (
                        <SettingRow key={label}>
                            <SettingLabel title={label} />
                            <SettingValue>{value || '—'}</SettingValue>
                        </SettingRow>
                    ))}
                </div>
            </Section>

            {/* Preferences */}
            <Section>
                <SectionTitle>{t('mobile.settings.preferences')}</SectionTitle>
                <div className="card">
                    <SettingRow>
                        <SettingLabel title={t('mobile.settings.theme')} subtitle={t('mobile.settings.themeSubtitle')} />
                        <SettingValue className="border-none cursor-pointer">
                            <select
                                className="bg-transparent border-none text-inherit cursor-pointer outline-none"
                                value={currentTheme}
                                onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setTheme(v); setCurrentTheme(v); }}
                            >
                                {THEMES.map(th => (
                                    <option key={th} value={th}>
                                        {th.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                                    </option>
                                ))}
                            </select>
                        </SettingValue>
                    </SettingRow>
                    <SettingRow>
                        <SettingLabel title={t('mobile.settings.language')} subtitle={t('mobile.settings.languageSubtitle')} />
                        <SettingValue className="border-none cursor-pointer">
                            <select
                                className="bg-transparent border-none text-inherit cursor-pointer outline-none"
                                value={lang}
                                onChange={(e) => setLang((e.target as HTMLSelectElement).value as Language)}
                            >
                                <option value="vi">{t('mobile.settings.vietnamese')}</option>
                                <option value="en">{t('mobile.settings.english')}</option>
                            </select>
                        </SettingValue>
                    </SettingRow>
                    <SettingRow>
                        <SettingLabel title={t('mobile.settings.scrollSync')} subtitle={t('mobile.settings.scrollSyncSubtitle')} />
                        <SettingValue className="border-none cursor-pointer">
                            <select
                                className="bg-transparent border-none text-inherit cursor-pointer outline-none"
                                value={scrollSyncRef.current ? 'on' : 'off'}
                                onChange={(e) => { const on = (e.target as HTMLSelectElement).value === 'on'; toggleScrollSync(on); }}
                            >
                                <option value="off">{t('mobile.common.off')}</option>
                                <option value="on">{t('mobile.common.on')}</option>
                            </select>
                        </SettingValue>
                    </SettingRow>
                </div>
            </Section>

            {/* Customization */}
            <Section>
                <SectionTitle>{t('customize.section.customize')}</SectionTitle>
                <div className="card">
                    <SettingRow>
                        <SettingLabel title={t('customize.toggle.showStream')} subtitle={t('customize.toggle.streamTabDesc')} />
                        <SettingValue className="border-none cursor-pointer">
                            <select
                                className="bg-transparent border-none text-inherit cursor-pointer outline-none"
                                value={mobileUI.showStreamTab ? 'on' : 'off'}
                                onChange={(e) => updateMobileSettings({ showStreamTab: (e.target as HTMLSelectElement).value === 'on' })}
                            >
                                <option value="off">{t('mobile.common.off')}</option>
                                <option value="on">{t('mobile.common.on')}</option>
                            </select>
                        </SettingValue>
                    </SettingRow>
                    <SettingRow>
                        <SettingLabel title={t('customize.toggle.showGit')} subtitle={t('customize.toggle.gitTabDesc')} />
                        <SettingValue className="border-none cursor-pointer">
                            <select
                                className="bg-transparent border-none text-inherit cursor-pointer outline-none"
                                value={mobileUI.showGitTab ? 'on' : 'off'}
                                onChange={(e) => updateMobileSettings({ showGitTab: (e.target as HTMLSelectElement).value === 'on' })}
                            >
                                <option value="off">{t('mobile.common.off')}</option>
                                <option value="on">{t('mobile.common.on')}</option>
                            </select>
                        </SettingValue>
                    </SettingRow>
                    <SettingRow>
                        <SettingLabel title={t('customize.toggle.showChat')} subtitle={t('customize.toggle.chatTabDesc')} />
                        <SettingValue className="border-none cursor-pointer">
                            <select
                                className="bg-transparent border-none text-inherit cursor-pointer outline-none"
                                value={mobileUI.showChatTab ? 'on' : 'off'}
                                onChange={(e) => updateMobileSettings({ showChatTab: (e.target as HTMLSelectElement).value === 'on' })}
                            >
                                <option value="off">{t('mobile.common.off')}</option>
                                <option value="on">{t('mobile.common.on')}</option>
                            </select>
                        </SettingValue>
                    </SettingRow>
                    <SettingRow>
                        <SettingLabel title={t('customize.toggle.showFiles')} subtitle={t('customize.toggle.filesTabDesc')} />
                        <SettingValue className="border-none cursor-pointer">
                            <select
                                className="bg-transparent border-none text-inherit cursor-pointer outline-none"
                                value={mobileUI.showFilesTab ? 'on' : 'off'}
                                onChange={(e) => updateMobileSettings({ showFilesTab: (e.target as HTMLSelectElement).value === 'on' })}
                            >
                                <option value="off">{t('mobile.common.off')}</option>
                                <option value="on">{t('mobile.common.on')}</option>
                            </select>
                        </SettingValue>
                    </SettingRow>
                </div>
            </Section>

            {/* Quick Commands */}
            <Section>
                <SectionTitle><Zap size={14} /> {t('mobile.settings.quickCommands')}</SectionTitle>
                <div className="card">
                    {commands.length === 0 ? (
                        <div className="text-[var(--text-muted)] p-2 text-[13px]">
                            {t('mobile.settings.noCommands')}
                        </div>
                    ) : (
                        commands.map((cmd, i) => (
                            <SettingRow key={i} onClick={() => executeCommand(i, cmd.prompt)}>
                                <SettingLabel
                                    title={cmd.label}
                                    subtitle={cmd.prompt.slice(0, 50) + (cmd.prompt.length > 50 ? '...' : '')}
                                />
                                <span className="text-base">{commandStatuses[i] || '▶'}</span>
                            </SettingRow>
                        ))
                    )}
                </div>
            </Section>

            {/* Model Quota */}
            <Section>
                <div className="flex items-center justify-between mb-2.5 pl-1">
                    <div className="flex items-center gap-2">
                        <Zap size={14} className="text-[var(--accent-primary)]" />
                        <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">{t('mobile.settings.modelQuota')}</span>
                    </div>
                    <button
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-glass)] border border-[var(--border)] rounded-full text-[var(--text-secondary)] text-[11px] font-medium cursor-pointer hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] transition-all ${quotaLoading ? 'opacity-60 pointer-events-none' : ''}`}
                        onClick={() => loadQuota()}
                    >
                        <RefreshCw size={12} className={quotaLoading ? 'animate-spin' : ''} />
                        {t('mobile.common.refresh')}
                    </button>
                </div>
                <div className="card">
                    {quotaLoading && !quotaData ? (
                        <div className="text-center p-10 text-[var(--text-muted)]">
                            <div className="spinner" />
                            <div className="mt-2.5">{t('mobile.settings.loadingQuota')}</div>
                        </div>
                    ) : !quotaData || !quotaData.available || !quotaData.models?.length ? (
                        <div className="text-center p-5 text-[var(--text-muted)] text-[13px]">
                            {quotaData?.error || t('mobile.settings.quotaNotFound')}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-3 mt-1">
                            {quotaData.models.map((model, i) => {
                                const circumference = 2 * Math.PI * 34;
                                const percent = Math.max(0, Math.min(100, model.remainingPercent || 0));
                                const offset = circumference - (percent / 100) * circumference;
                                const displayName = formatModelName(model.name);
                                const colors = STATUS_COLORS[model.status] || STATUS_COLORS.healthy;

                                return (
                                    <div key={i} className="relative bg-[var(--bg-glass)] border border-[var(--border)] rounded-2xl p-4 text-center transition-all duration-300 hover:border-[var(--border-hover)] hover:-translate-y-0.5 overflow-hidden group">
                                        {/* Subtle glow background */}
                                        <div
                                            className="absolute inset-0 opacity-[0.06] group-hover:opacity-[0.12] transition-opacity duration-500 rounded-2xl"
                                            style={{ background: `radial-gradient(circle at 50% 30%, ${colors.stroke}, transparent 70%)` }}
                                        />

                                        {/* Quota Ring */}
                                        <div className="relative w-[72px] h-[72px] mx-auto mb-2.5">
                                            <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                                                <circle cx="40" cy="40" r="34"
                                                    fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5"
                                                />
                                                <circle cx="40" cy="40" r="34"
                                                    fill="none" stroke={colors.stroke} strokeWidth="5"
                                                    strokeLinecap="round"
                                                    strokeDasharray={circumference} strokeDashoffset={offset}
                                                    className="transition-[stroke-dashoffset] duration-700 ease-out"
                                                    style={{ filter: `drop-shadow(0 0 4px ${colors.stroke})` }}
                                                />
                                            </svg>
                                            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-base font-bold tabular-nums ${colors.text}`}>
                                                {percent.toFixed(0)}%
                                            </div>
                                        </div>

                                        {/* Model Name */}
                                        <div className="relative text-[12px] font-semibold text-[var(--text-primary)] mb-1 whitespace-nowrap overflow-hidden text-ellipsis" title={model.name}>
                                            {displayName}
                                        </div>

                                        {/* Linear progress bar */}
                                        <div className="relative w-full h-1 bg-[rgba(255,255,255,0.06)] rounded-full mt-1.5 mb-2 overflow-hidden">
                                            <div
                                                className="h-full rounded-full transition-all duration-700 ease-out"
                                                style={{
                                                    width: `${percent}%`,
                                                    background: colors.stroke,
                                                    boxShadow: `0 0 6px ${colors.stroke}`,
                                                }}
                                            />
                                        </div>

                                        {/* Reset Timer */}
                                        {model.resetIn && (
                                            <div className="relative text-[10px] text-[var(--text-muted)] flex items-center gap-1 justify-center mb-1">
                                                <Timer size={10} /> {model.resetIn}
                                            </div>
                                        )}

                                        {/* Status Badge */}
                                        <div className="relative flex items-center justify-center gap-1 mt-1">
                                            <span
                                                className="w-1.5 h-1.5 rounded-full inline-block"
                                                style={{ background: colors.stroke, boxShadow: `0 0 4px ${colors.stroke}` }}
                                            />
                                            <span className={`text-[9px] font-bold uppercase tracking-wider ${colors.text}`}>
                                                {model.status}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </Section>

            {/* Clear Cache */}
            <div className="pt-2 border-t border-[var(--border)]">
                <button
                    className="w-full p-3 bg-[rgba(243,139,168,0.1)] border border-[rgba(243,139,168,0.3)] rounded-[10px] text-[#f38ba8] text-sm cursor-pointer flex items-center justify-center gap-1"
                    onClick={async () => {
                        try {
                            await authFetch(`${getServerUrl()}/api/chat/clear-cache`, { method: 'POST' });
                            showToast(t('mobile.settings.cacheCleared'), 'success');
                        } catch (_e) { showToast(t('mobile.settings.cacheClearFailed'), 'error'); }
                    }}
                ><Trash2 size={14} /> {t('mobile.settings.clearIdeCache')}</button>
            </div>

            {/* Clear Mobile Chat Data */}
            <div className="pt-2 border-t border-[var(--border)] mt-2">
                <button
                    className="w-full p-3 bg-[rgba(243,139,168,0.1)] border border-[rgba(243,139,168,0.3)] rounded-[10px] text-[#f38ba8] text-sm cursor-pointer flex items-center justify-center gap-1"
                    onClick={async () => {
                        if (confirm(t('mobile.settings.confirmClearChat'))) {
                            try {
                                await authFetch(`${getServerUrl()}/api/messages/clear`, { method: 'POST' });
                                showToast(t('mobile.settings.mobileDataCleared'), 'success');
                            } catch (_e) { showToast(t('mobile.settings.mobileDataClearFailed'), 'error'); }
                        }
                    }}
                ><Trash2 size={14} /> {t('mobile.settings.clearMobileData')}</button>
            </div>

            {/* Admin Panel Link */}
            <div className="pt-4 mt-4 border-t border-[var(--border)]">
                <a
                    href="/admin"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full p-3 bg-[var(--accent-primary,#6c5ce7)]/10 border border-[var(--accent-primary,#6c5ce7)]/30 rounded-[10px] text-[var(--accent-primary,#6c5ce7)] text-sm font-semibold cursor-pointer flex items-center justify-center gap-2 no-underline hover:bg-[var(--accent-primary,#6c5ce7)]/20 transition-colors"
                >
                    <Shield size={16} />
                    {t('mobile.settings.adminPanel')}
                </a>
            </div>

            {/* Sponsorship */}
            <div className="py-4 text-center opacity-50 hover:opacity-100 transition-opacity">
                <a href="https://xcloudphone.com?utm_source=AntigravityMobile" target="_blank" rel="noopener noreferrer" className="text-[11px] text-[var(--text-muted)] no-underline inline-flex flex-col items-center gap-2 group">
                    <span className="group-hover:text-[var(--text-primary)] transition-colors">{t('common.sponsoredBy')}</span>
                    <img
                        src="https://xcloudphone.com/logo-light.svg"
                        alt="xCloudPhone"
                        className="sponsor-logo-dark h-6 w-auto opacity-80 group-hover:opacity-100 transition-opacity"
                    />
                    <img
                        src="https://xcloudphone.com/logo-dark.svg"
                        alt="xCloudPhone"
                        className="sponsor-logo-light h-6 w-auto opacity-80 group-hover:opacity-100 transition-opacity"
                    />
                                        <span className="font-bold text-[var(--brand)] text-xs border-b border-transparent group-hover:border-[var(--brand)] transition-all">xCloudPhone.com</span>
                </a>
            </div>
            </div>
        </OrnamentWrapper>
    );
}
