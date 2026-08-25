// ================== Supabase設定 ==================
const SUPABASE_URL = 'https://rlhycrnkmhrhweuvpceq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vuEUN4e5-QOdH-RZsVXvng_IHMCRjiz';

// Supabase クライアント（カスタム実装）
class SupabaseClient {
    constructor(url, anonKey) {
        this.url = url;
        this.anonKey = anonKey;
        this.session = null;
        this.user = null;
    }

    async _request(method, endpoint, body = null) {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'apikey': this.anonKey,
            },
        };

        if (this.session?.access_token) {
            options.headers['Authorization'] = `Bearer ${this.session.access_token}`;
        }

        // PostgRESTは既定でPOST/PATCHのレスポンスボディを返さない（201/204＋空ボディ）。
        // 挿入・更新後の行（idなど）が必要なので representation を明示的に要求する。
        if (method === 'POST' || method === 'PATCH') {
            options.headers['Prefer'] = 'return=representation';
        }

        if (body) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(`${this.url}${endpoint}`, options);

        // 空ボディ（204など）やJSON以外のレスポンスでも例外にならないようにする
        const text = await response.text();
        let data = null;
        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                data = null;
            }
        }

        if (!response.ok) {
            const error = new Error(
                (data && (data.message || data.error_description)) || `API Error (${response.status})`
            );
            error.status = response.status;
            error.code = data?.code;
            throw error;
        }

        return data ?? [];
    }

    // Auth: メール＋パスワード登録
    async auth_signUp(email, password) {
        const response = await fetch(`${this.url}/auth/v1/signup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': this.anonKey,
            },
            body: JSON.stringify({ email, password }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || data.error_description || 'Signup failed');
        }
        return data;
    }

    // Auth: メール＋パスワードでログイン
    async auth_signInWithPassword(email, password) {
        const response = await fetch(`${this.url}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': this.anonKey,
            },
            body: JSON.stringify({ email, password }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || data.error_description || 'Login failed');
        }
        this.session = data;
        this.user = data.user;
        return data;
    }

    // Auth: OAuth（Google/GitHub）
    async auth_signInWithOAuth(provider) {
        // Supabase Authのリダイレクトページを開く
        const params = new URLSearchParams({
            provider,
            redirect_to: window.location.origin,
        });
        window.location.href = `${this.url}/auth/v1/authorize?${params}`;
    }

    // Auth: ログアウト
    async auth_signOut() {
        if (this.session?.access_token) {
            await fetch(`${this.url}/auth/v1/logout`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.session.access_token}`,
                    'apikey': this.anonKey,
                },
            });
        }
        this.session = null;
        this.user = null;
    }

    // Auth: セッション復元（ローカルストレージから）
    async auth_restoreSession() {
        const sessionJson = localStorage.getItem('sb-session');
        if (sessionJson) {
            this.session = JSON.parse(sessionJson);
            this.user = this.session.user;
        }
        return this.session;
    }

    // DB: データ読み込み（GET）
    from(table) {
        return {
            select: async (columns = '*') => {
                const endpoint = `/rest/v1/${table}?select=${columns}`;
                return this._request('GET', endpoint);
            },
            insert: async (records) => {
                const endpoint = `/rest/v1/${table}`;
                return this._request('POST', endpoint, records);
            },
            update: async (record, matchColumn = 'id') => {
                const { [matchColumn]: matchValue, ...data } = record;
                const endpoint = `/rest/v1/${table}?${matchColumn}=eq.${matchValue}`;
                return this._request('PATCH', endpoint, data);
            },
            delete: async (matchValue, matchColumn = 'id') => {
                const endpoint = `/rest/v1/${table}?${matchColumn}=eq.${matchValue}`;
                return this._request('DELETE', endpoint);
            },
        };
    }
}

const supabase = new SupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ================== アプリケーション状態 ==================
const appState = {
    user: null,
    currentTab: 'home',
    vocabularies: [],
    userProfile: null,
    studyGoal: 0,
    learnedVocabCount: 0,
    isLoading: false,
    error: null,
    learnSubTab: 'practice',
    practice: createInitialPracticeState(),
    editingVocabId: null,
};

function createInitialPracticeState() {
    return {
        formParams: { industry: '', scenarioType: '', difficulty: 'medium' },
        scenario: null,
        isRecording: false,
        recognition: null,
        transcript: '',
        startTime: null,
        duration: 0,
        timerInterval: null,
        remainingSeconds: 0,
        feedback: null,
        isAnalyzing: false,
        addedSuggestions: {},
    };
}

// ================== UI更新関数 ==================
function renderApp() {
    const app = document.getElementById('app');

    if (!appState.user) {
        renderAuthPage(app);
    } else {
        renderMainApp(app);
    }
}

function renderAuthPage(app) {
    app.innerHTML = `
        <div class="auth-container">
            <div class="auth-box">
                <h2>japyjapy</h2>
                ${appState.error ? `<div class="error-message">${escapeHtml(appState.error)}</div>` : ''}
                
                <div id="auth-form-container">
                    <!-- ログインフォーム（デフォルト） -->
                    <div id="login-form">
                        <h3>ログイン</h3>
                        <div class="form-group">
                            <label>メールアドレス</label>
                            <input type="email" id="login-email" placeholder="your@email.com">
                        </div>
                        <div class="form-group">
                            <label>パスワード</label>
                            <input type="password" id="login-password" placeholder="••••••••">
                        </div>
                        <button class="btn-primary" onclick="handleLogin()">ログイン</button>
                        <div class="auth-toggle">
                            新規アカウントをお持ちですか？
                            <button onclick="toggleAuthForm()">サインアップ</button>
                        </div>
                    </div>

                    <!-- サインアップフォーム（非表示） -->
                    <div id="signup-form" class="hidden">
                        <h3>アカウント作成</h3>
                        <div class="form-group">
                            <label>メールアドレス</label>
                            <input type="email" id="signup-email" placeholder="your@email.com">
                        </div>
                        <div class="form-group">
                            <label>パスワード</label>
                            <input type="password" id="signup-password" placeholder="••••••••（8文字以上）">
                        </div>
                        <div class="form-group">
                            <label>パスワード確認</label>
                            <input type="password" id="signup-password-confirm" placeholder="••••••••">
                        </div>
                        <button class="btn-primary" onclick="handleSignup()">サインアップ</button>
                        <div class="auth-toggle">
                            アカウントをお持ちですか？
                            <button onclick="toggleAuthForm()">ログイン</button>
                        </div>
                    </div>
                </div>

                <div class="oauth-buttons">
                    <button class="oauth-btn" onclick="handleOAuthGoogle()">
                        🔵 Googleでログイン
                    </button>
                    <button class="oauth-btn" onclick="handleOAuthGitHub()">
                        ⬛ GitHubでログイン
                    </button>
                </div>
            </div>
        </div>
    `;
}

function renderMainApp(app) {
    app.innerHTML = `
        <nav class="navbar">
            <div class="navbar-title">japyjapy</div>
            <div class="navbar-actions">
                <button class="theme-toggle" onclick="toggleTheme()" title="テーマ切り替え">🌙</button>
                <span class="user-info">${escapeHtml(appState.user.email)}</span>
                <button class="logout-btn" onclick="handleLogout()">ログアウト</button>
            </div>
        </nav>

        <div class="tab-navigation">
            <button class="tab-button ${appState.currentTab === 'home' ? 'active' : ''}" onclick="switchTab('home')">ホーム</button>
            <button class="tab-button ${appState.currentTab === 'learn' ? 'active' : ''}" onclick="switchTab('learn')">学習</button>
            <button class="tab-button ${appState.currentTab === 'profile' ? 'active' : ''}" onclick="switchTab('profile')">プロフィール</button>
        </div>

        <div class="container">
            <div class="page-content">
                ${renderTabContent()}
            </div>
        </div>
    `;
}

function renderTabContent() {
    switch (appState.currentTab) {
        case 'home':
            return renderHomeTab();
        case 'learn':
            return renderLearnTab();
        case 'profile':
            return renderProfileTab();
        default:
            return '';
    }
}

function renderHomeTab() {
    return `
        <h1>ホーム</h1>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${appState.vocabularies.length}</div>
                <div class="stat-label">学習語彙数</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${calculateStudyDays()}</div>
                <div class="stat-label">学習日数</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${appState.studyGoal}</div>
                <div class="stat-label">目標語数</div>
            </div>
        </div>

        <div class="progress-section">
            <div class="progress-label">
                <span>学習目標への進捗</span>
                <span>${Math.min(appState.vocabularies.length, appState.studyGoal)} / ${appState.studyGoal}</span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${appState.studyGoal > 0 ? Math.min((appState.vocabularies.length / appState.studyGoal) * 100, 100) : 0}%"></div>
            </div>
        </div>

        <div class="chart-section">
            <h3>語彙登録数の推移（過去14日間）</h3>
            ${appState.vocabularies.length > 0 ? renderStudyChart() : '<p class="chart-empty">まだデータがありません。単語を追加すると、ここに推移が表示されます。</p>'}
        </div>

        <div class="study-goal-section">
            <h3>学習目標を設定</h3>
            <div class="goal-input-group">
                <input type="number" id="goal-input" value="${appState.studyGoal}" min="1" placeholder="目標語彙数">
                <button onclick="updateStudyGoal()">設定</button>
            </div>
            ${appState.studyGoal > 0 ? `
                <div class="goal-display">
                    あと <strong>${Math.max(0, appState.studyGoal - appState.vocabularies.length)}</strong> 語を学習すると目標達成です！
                </div>
            ` : ''}
        </div>
    `;
}

// 過去N日間の日別・累計の語彙登録数を計算する。
// 「復習頻度」「習得度の推移」は learned_at 等の履歴データがDBに無いため算出できない。
// 現状のスキーマで取得できる created_at のみを使い、語彙登録数の推移として表示する。
function computeDailyVocabCounts(days = 14) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const buckets = [];
    for (let i = days - 1; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        buckets.push({ date, added: 0 });
    }
    const windowStart = buckets[0].date.getTime();

    let priorCount = 0;
    appState.vocabularies.forEach(v => {
        if (!v.created_at) return;
        const created = new Date(v.created_at);
        created.setHours(0, 0, 0, 0);
        const createdTime = created.getTime();
        if (createdTime < windowStart) {
            priorCount += 1;
            return;
        }
        const bucket = buckets.find(b => b.date.getTime() === createdTime);
        if (bucket) bucket.added += 1;
    });

    let cumulative = priorCount;
    return buckets.map(b => {
        cumulative += b.added;
        return { date: b.date, added: b.added, cumulative };
    });
}

function renderStudyChart() {
    const data = computeDailyVocabCounts(14);
    const maxCumulative = Math.max(1, ...data.map(d => d.cumulative));
    const width = 600;
    const height = 180;
    const paddingLeft = 30;
    const paddingRight = 12;
    const paddingTop = 16;
    const paddingBottom = 24;
    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;
    const stepX = data.length > 1 ? plotWidth / (data.length - 1) : 0;

    const points = data.map((d, i) => ({
        x: paddingLeft + i * stepX,
        y: paddingTop + plotHeight - (d.cumulative / maxCumulative) * plotHeight,
        d,
    }));

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const baseline = paddingTop + plotHeight;
    const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${baseline} L${points[0].x.toFixed(1)},${baseline} Z`;

    const labelEvery = Math.ceil(data.length / 6);
    const xLabels = points
        .map((p, i) => {
            if (i % labelEvery !== 0 && i !== points.length - 1) return '';
            const label = `${p.d.date.getMonth() + 1}/${p.d.date.getDate()}`;
            return `<text x="${p.x.toFixed(1)}" y="${height - 6}" font-size="10" fill="var(--text-tertiary)" text-anchor="middle">${label}</text>`;
        })
        .join('');

    const dots = points
        .map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="var(--accent-color)"><title>${p.d.date.getMonth() + 1}/${p.d.date.getDate()}：累計${p.d.cumulative}語</title></circle>`)
        .join('');

    return `
        <svg viewBox="0 0 ${width} ${height}" class="study-chart-svg" role="img" aria-label="語彙登録数の推移グラフ">
            <line x1="${paddingLeft}" y1="${paddingTop}" x2="${paddingLeft}" y2="${baseline}" stroke="var(--border-color)" />
            <line x1="${paddingLeft}" y1="${baseline}" x2="${width - paddingRight}" y2="${baseline}" stroke="var(--border-color)" />
            <path d="${areaPath}" fill="var(--accent-color)" opacity="0.12" stroke="none" />
            <path d="${linePath}" fill="none" stroke="var(--accent-color)" stroke-width="2" />
            ${dots}
            ${xLabels}
            <text x="${paddingLeft}" y="${paddingTop - 4}" font-size="10" fill="var(--text-tertiary)">累計 ${maxCumulative}語</text>
        </svg>
    `;
}

function renderLearnTab() {
    return `
        <h1>学習</h1>
        <div class="sub-tab-navigation">
            <button class="sub-tab-button ${appState.learnSubTab === 'practice' ? 'active' : ''}" onclick="switchLearnSubTab('practice')">スピーキング練習</button>
            <button class="sub-tab-button ${appState.learnSubTab === 'wordbook' ? 'active' : ''}" onclick="switchLearnSubTab('wordbook')">単語帳</button>
        </div>
        ${appState.learnSubTab === 'practice' ? renderPracticeSubTab() : renderWordbookSubTab()}
    `;
}

function renderWordbookSubTab() {
    if (appState.isLoading) {
        return `<div class="loading"><div class="spinner"></div>読み込み中...</div>`;
    }

    if (appState.vocabularies.length === 0) {
        return `
            <div class="empty-state">
                <div class="empty-state-icon">📚</div>
                <p>まだ語彙が登録されていません</p>
                <button class="btn-add-vocab" onclick="toggleAddVocabForm()">語彙を追加</button>
                <div id="add-vocab-form-container"></div>
            </div>
        `;
    }

    return `
        <button class="btn-add-vocab" onclick="toggleAddVocabForm()">新しい語彙を追加</button>
        <div id="add-vocab-form-container"></div>
        <div id="vocabularies-container">
            ${appState.vocabularies.map(vocab => renderVocabularyCard(vocab)).join('')}
        </div>
    `;
}

// ================== スピーキング練習（中国語職場表現トレーニング）==================
// 現在はデモ版のため、AI APIは接続していません。
// generate_scenario / analyze_response の入出力仕様は docs/system-prompt.md を参照し、
// 本番実装時は mockGenerateScenario / mockAnalyzeResponse を実際のLLM API呼び出しに置き換えてください。

const SCENARIO_POOL = [
    {
        type: '進捗報告',
        scenario_title: '週次進捗報告',
        context: '月曜朝のチーム定例会議。直属の上司ともう二人の同僚が同席しています。あなたの番になり、先週担当したプロジェクトの進捗を報告します。',
        your_task: '簡潔な言葉で先週のプロジェクト進捗を報告してください。制限時間を超えないように。',
        key_info: [
            'プロジェクト名：新ユーザーインターフェース刷新',
            '全体進捗：80%完了、ユーザーテストを開始',
            'テスト結果：120名が参加、78%が好意的な評価',
            '発見された問題：ナビゲーションボタンの配置、メインカラーのコントラスト不足',
            '来週の計画：フィードバックを踏まえて調整、3日程度で完了予定',
        ],
        tips: '結論から先に話し、その後で詳細を展開しましょう。',
    },
    {
        type: '顧客対応',
        scenario_title: '顧客クレーム対応会議',
        context: '営業担当と一緒に、重要な顧客との電話会議に参加しています。顧客は先月納品した機能に不満を持っています。',
        your_task: '顧客に問題の原因を説明し、解決策とスケジュールを提示してください。',
        key_info: [
            '問題：データエクスポート機能が断続的にタイムアウトする',
            '原因：ピーク時にサーバー負荷が高くなっている',
            '実施済みの対策：サーバー増強、クエリロジックの最適化',
            '完全復旧の見込み：今週金曜日',
            '今後の対応：毎週の進捗共有を実施予定',
        ],
        tips: 'まず理解と謝意を示し、その後で具体的な対応策を伝えましょう。言い訳は避けること。',
    },
    {
        type: '部門連携',
        scenario_title: '部門横断連携会議での発言',
        context: 'プロダクト、開発、マーケティングの三部門による月次連携会議。あなたはプロダクトチームを代表し、来四半期の重点計画と他部門への協力依頼事項を報告します。',
        your_task: 'プロダクトの来四半期計画を報告し、開発・マーケティング部門に必要な協力事項を明確に伝えてください。',
        key_info: [
            '目標：新規ユーザーの翌日継続率向上',
            '施策：オンボーディングフローの改善、パーソナライズ推薦機能のリリース',
            '開発への依頼：バックエンドエンジニア2名、想定工数6週間',
            'マーケティングへの依頼：リリースのタイミングに合わせた事前告知',
            'リスク：推薦アルゴリズムが依存するデータパイプラインが未完成',
        ],
        tips: 'まず目標を明確にし、その後で各部門への具体的な依頼事項を挙げましょう。',
    },
    {
        type: 'トラブル報告',
        scenario_title: '緊急トラブル報告',
        context: '本番環境で一部のユーザーに影響する問題を発見しました。急遽招集された短い会議で、上司に状況を説明します。',
        your_task: '問題の現状、影響範囲、対応計画を簡潔に説明してください。',
        key_info: [
            '問題：約5%のユーザーが決済を完了できない',
            '影響時間：すでに40分継続中',
            '実施済みの対策：該当決済手段を一時停止し、代替手段へ誘導',
            '根本原因：サードパーティ決済APIの証明書期限切れ',
            '復旧見込み：1時間以内',
        ],
        tips: 'まず影響範囲とすでに取った応急対応を伝え、その後で根本原因を説明しましょう。',
    },
];

const DIFFICULTY_TIME_LIMIT = { easy: 90, medium: 120, hard: 150 };

const FILLER_LOOKUP = [
    { keys: ['あの件', 'その件', 'あれ'], improved: '（具体的な案件名・プロジェクト名）を進める', reason: '「あの/その」といった曖昧な指示語を避け、対象を明確にしましょう', addable: true },
    { keys: ['たぶん', 'なんとなく', 'かもしれないですけど'], improved: '想定では[X]、[根拠]に基づく見込みです', reason: '曖昧な「たぶん」を避け、根拠のある見込みを示すと説得力が増します', addable: true },
    { keys: ['まあまあ', 'そこそこ', '微妙'], improved: 'おおむね想定通り／期待に沿う結果', reason: '「まあまあ」は程度が曖昧なので、より明確な評価表現に置き換えましょう', addable: true },
    { keys: ['ちょっと直す', 'ちょこっと調整', 'ちょっといじる'], improved: '調整する／改善する', reason: 'カジュアルな言い回しは正式な報告にふさわしくないため、より専門的な表現に置き換えましょう', addable: true },
    { keys: ['たしか', 'だったと思います'], improved: '（確定した結論を述べる、または要確認と明記する）', reason: '不確かな言い回しは報告の説得力を弱めます', addable: false },
];

function mockGenerateScenario(params) {
    const pool = params.scenarioType
        ? SCENARIO_POOL.filter(s => s.type === params.scenarioType)
        : SCENARIO_POOL;
    const candidates = pool.length > 0 ? pool : SCENARIO_POOL;
    const picked = candidates[Math.floor(Math.random() * candidates.length)];
    const timeLimitSeconds = DIFFICULTY_TIME_LIMIT[params.difficulty] || DIFFICULTY_TIME_LIMIT.medium;

    return {
        scenario_title: picked.scenario_title,
        context: picked.context,
        your_task: picked.your_task,
        time_limit_seconds: timeLimitSeconds,
        key_info: picked.key_info,
        tips: picked.tips,
    };
}

function extractSnippet(text, keyword, radius = 6) {
    const idx = text.indexOf(keyword);
    if (idx === -1) return keyword;
    const start = Math.max(0, idx - radius);
    const end = Math.min(text.length, idx + keyword.length + radius);
    return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

function mockAnalyzeResponse(scenario, transcript, durationSeconds) {
    const trimmed = transcript.trim();
    const limit = scenario.time_limit_seconds;

    let durationFeedback;
    if (durationSeconds > limit) {
        durationFeedback = `発言時間が${durationSeconds - limit}秒オーバーしています。時間配分に注意しましょう。`;
    } else if (durationSeconds < limit * 0.5) {
        durationFeedback = `発言時間が短めです（${durationSeconds}秒）。内容が不足している可能性があるので、詳細を補足しましょう。`;
    } else {
        durationFeedback = `時間配分は適切です（${durationSeconds}秒、制限時間内）。`;
    }

    const suggestions = [];
    FILLER_LOOKUP.forEach(entry => {
        if (suggestions.length >= 5) return;
        const matchedKey = entry.keys.find(k => trimmed.includes(k));
        if (matchedKey) {
            suggestions.push({
                original: extractSnippet(trimmed, matchedKey),
                improved: entry.improved,
                reason: entry.reason,
                addable_to_wordbook: entry.addable,
            });
        }
    });

    const issues = [];
    const hasConclusionFirst = /^.{0,15}(結論から|まとめると|結論として|要点は|端的に言うと)/.test(trimmed);
    const hasNumbering = /まず|一つ目|最初に/.test(trimmed);
    const hasNextStep = /次のステップ|今後|予定|計画|対応します|確認したい/.test(trimmed.slice(-40));

    if (!hasConclusionFirst) {
        issues.push({
            problem: '冒頭で結論が示されておらず、聞き手は最後まで要点がわかりません',
            example_from_user: trimmed.slice(0, 20) + (trimmed.length > 20 ? '…' : ''),
            how_to_fix: '結論から話し始め、最初の一文で全体の結果を伝えましょう',
        });
    }
    if (issues.length < 3 && !hasNumbering) {
        issues.push({
            problem: '発言に区切りがなく、内容が羅列的で構成がわかりにくいです',
            example_from_user: trimmed.slice(0, 30) + (trimmed.length > 30 ? '…' : ''),
            how_to_fix: '「まず、次に、最後に」のように要点を整理して伝えましょう',
        });
    }
    if (issues.length < 3 && !hasNextStep) {
        issues.push({
            problem: '締めくくりに具体的な次のステップや依頼事項がありません',
            example_from_user: trimmed.slice(-20),
            how_to_fix: '具体的な期限と次の計画を示すか、確認してほしい事項を明確に伝えましょう',
        });
    }

    const whatWentWell = trimmed.length > 40
        ? '内容の情報量は十分で、状況を幅広くカバーできています。これは良い土台です。'
        : '発言できたこと自体が大切な一歩です。今後の練習で内容をさらに充実させましょう。';

    let cleaned = trimmed;
    FILLER_LOOKUP.forEach(entry => {
        entry.keys.forEach(k => {
            cleaned = cleaned.split(k).join('');
        });
    });
    const sentences = cleaned.split(/[。！？、]/).map(s => s.trim()).filter(Boolean);
    const numbered = ['まず、', '次に、', '最後に、'];
    const polishedBody = sentences.slice(0, 3).map((s, i) => `${numbered[i]}${s}。`).join('');
    const polishedVersion = trimmed
        ? `${scenario.scenario_title}について、要点をお伝えします。${polishedBody || '[ここに具体的な内容を補足することをおすすめします]'}以上が報告内容です。追加で必要な情報があれば補足いたします。`
        : '[発言内容が検出されませんでした。録音するか文字を入力してください]';

    return {
        transcript_display: transcript,
        duration_feedback: durationFeedback,
        polished_version: polishedVersion,
        structure_feedback: {
            summary: issues.length > 0
                ? '内容の要素はおおむね揃っていますが、伝え方の構成にはまだ改善の余地があります。'
                : '構成はすでに明確です。この調子を続けましょう。',
            issues,
            what_went_well: whatWentWell,
        },
        vocabulary_feedback: {
            summary: suggestions.length > 0
                ? '言葉遣いの中に、より的確な表現に置き換えられる部分があります。'
                : '言葉遣いはすでに的確で、目立った話し言葉的な表現は見つかりませんでした。',
            suggestions,
        },
    };
}

function isSpeechRecognitionSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function formatTime(totalSeconds) {
    const s = Math.max(0, totalSeconds);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function renderPracticeSubTab() {
    const p = appState.practice;
    if (p.feedback) return renderFeedbackResult();
    if (p.scenario) return renderActiveScenario();
    return renderScenarioSetupForm();
}

function renderScenarioSetupForm() {
    const fp = appState.practice.formParams;
    return `
        <div class="scenario-setup">
            <p class="setup-intro">日本語での即興発言を練習しましょう。業界と難易度を選んで、練習を開始してください。</p>
            <div class="form-group">
                <label>業界（任意）</label>
                <input type="text" id="setup-industry" placeholder="例: インターネット / 金融" value="${escapeHtml(fp.industry)}">
            </div>
            <div class="form-group">
                <label>場面タイプ</label>
                <select id="setup-scenario-type">
                    <option value="">おまかせ</option>
                    <option value="進捗報告" ${fp.scenarioType === '進捗報告' ? 'selected' : ''}>進捗報告</option>
                    <option value="顧客対応" ${fp.scenarioType === '顧客対応' ? 'selected' : ''}>顧客対応</option>
                    <option value="部門連携" ${fp.scenarioType === '部門連携' ? 'selected' : ''}>部門連携</option>
                    <option value="トラブル報告" ${fp.scenarioType === 'トラブル報告' ? 'selected' : ''}>トラブル報告</option>
                </select>
            </div>
            <div class="form-group">
                <label>難易度</label>
                <select id="setup-difficulty">
                    <option value="easy" ${fp.difficulty === 'easy' ? 'selected' : ''}>やさしい（90秒）</option>
                    <option value="medium" ${fp.difficulty === 'medium' ? 'selected' : ''}>ふつう（120秒）</option>
                    <option value="hard" ${fp.difficulty === 'hard' ? 'selected' : ''}>むずかしい（150秒）</option>
                </select>
            </div>
            <button class="btn-primary" onclick="generatePracticeScenario()">情景を生成する</button>
            <p class="mock-note">※ 現在はデモ版のため、AIではなくサンプルデータで情景と講評を生成しています。</p>
        </div>
    `;
}

function renderActiveScenario() {
    const p = appState.practice;
    const s = p.scenario;
    const speechSupported = isSpeechRecognitionSupported();

    return `
        <div class="scenario-card">
            <div class="scenario-header">
                <h3>${escapeHtml(s.scenario_title)}</h3>
                <div class="timer-display" id="timer-display">${formatTime(p.remainingSeconds)}</div>
            </div>
            <p class="scenario-context">${escapeHtml(s.context)}</p>
            <div class="scenario-task"><strong>タスク：</strong>${escapeHtml(s.your_task)}</div>
            <div class="key-info-box">
                <div class="key-info-title">使える情報</div>
                <ul class="key-info-list">
                    ${s.key_info.map(k => `<li>${escapeHtml(k)}</li>`).join('')}
                </ul>
            </div>
            <div class="scenario-tips">💡 ${escapeHtml(s.tips)}</div>
        </div>

        <div class="recording-panel">
            ${speechSupported ? `
                <button id="record-btn" class="record-btn ${p.isRecording ? 'recording' : ''}" onclick="${p.isRecording ? 'stopRecording()' : 'startRecording()'}">
                    ${p.isRecording ? '⏹ 録音を終了' : '🎙 録音を開始'}
                </button>
            ` : `
                <p class="speech-unsupported">お使いのブラウザは音声認識に対応していません。下のテキスト欄に直接入力してください。</p>
            `}
            <label class="transcript-label">発言内容（文字起こし・編集可）</label>
            <textarea id="practice-transcript" class="transcript-box" placeholder="ここに発言内容が表示されます。録音後に自由に編集できます。" oninput="updatePracticeTranscript(this.value)" ${p.isRecording ? 'readonly' : ''}>${escapeHtml(p.transcript)}</textarea>
            <div class="practice-actions">
                <button class="btn-primary" ${(!p.transcript.trim() || p.isRecording || p.isAnalyzing) ? 'disabled' : ''} onclick="submitForAnalysis()">
                    ${p.isAnalyzing ? '分析中...' : '分析する'}
                </button>
                <button class="btn-cancel" onclick="resetPractice()">情景をやり直す</button>
            </div>
        </div>
    `;
}

function renderFeedbackResult() {
    const p = appState.practice;
    const f = p.feedback;

    return `
        <div class="feedback-container">
            <div class="feedback-section">
                <div class="feedback-section-title">あなたの発言</div>
                <div class="transcript-display-box">${escapeHtml(f.transcript_display)}</div>
                <div class="duration-feedback">⏱ ${escapeHtml(f.duration_feedback)}</div>
            </div>

            <div class="feedback-section polished-section">
                <div class="feedback-section-title">模範解答（お手本）</div>
                <div class="polished-version-box">${escapeHtml(f.polished_version)}</div>
            </div>

            <div class="feedback-section">
                <div class="feedback-section-title">構成へのフィードバック</div>
                <p class="feedback-summary">${escapeHtml(f.structure_feedback.summary)}</p>
                ${f.structure_feedback.issues.map(issue => `
                    <div class="issue-card">
                        <div class="issue-problem">⚠ ${escapeHtml(issue.problem)}</div>
                        <div class="issue-example">元の発言：「${escapeHtml(issue.example_from_user)}」</div>
                        <div class="issue-fix">✓ ${escapeHtml(issue.how_to_fix)}</div>
                    </div>
                `).join('')}
                <div class="what-went-well">👍 ${escapeHtml(f.structure_feedback.what_went_well)}</div>
            </div>

            <div class="feedback-section">
                <div class="feedback-section-title">語彙へのフィードバック</div>
                <p class="feedback-summary">${escapeHtml(f.vocabulary_feedback.summary)}</p>
                ${f.vocabulary_feedback.suggestions.map((sug, i) => `
                    <div class="suggestion-card">
                        <div class="suggestion-row">
                            <span class="suggestion-original">${escapeHtml(sug.original)}</span>
                            <span class="suggestion-arrow">→</span>
                            <span class="suggestion-improved">${escapeHtml(sug.improved)}</span>
                        </div>
                        <div class="suggestion-reason">${escapeHtml(sug.reason)}</div>
                        ${sug.addable_to_wordbook ? `
                            <button class="btn-small ${p.addedSuggestions[i] ? 'marked' : ''}" ${p.addedSuggestions[i] ? 'disabled' : ''} onclick="addSuggestionToWordbook(${i})">
                                ${p.addedSuggestions[i] ? '✓ 単語帳に追加済み' : '+ 単語帳に追加'}
                            </button>
                        ` : ''}
                    </div>
                `).join('')}
            </div>

            <div class="practice-actions">
                <button class="btn-primary" onclick="retryPractice()">この情景でもう一度</button>
                <button class="btn-add-vocab" onclick="resetPractice()">新しい情景で練習</button>
            </div>
        </div>
    `;
}

function renderVocabularyCard(vocab) {
    if (appState.editingVocabId === vocab.id) {
        return renderVocabularyEditForm(vocab);
    }

    return `
        <div class="vocabulary-card">
            <div class="vocab-word">${escapeHtml(vocab.word)}</div>
            <div class="vocab-reading">${escapeHtml(vocab.reading || '')}</div>
            <div class="vocab-meaning">${escapeHtml(vocab.meaning)}</div>
            ${vocab.example ? `
                <div class="vocab-example">
                    <div class="vocab-example-title">例文</div>
                    <div class="vocab-example-text">${escapeHtml(vocab.example)}</div>
                </div>
            ` : ''}
            ${vocab.scenario ? `
                <div class="vocab-scenario">
                    <div class="vocab-scenario-title">使用場景</div>
                    <div class="vocab-scenario-text">${escapeHtml(vocab.scenario)}</div>
                </div>
            ` : ''}
            <div class="vocab-actions">
                <button class="btn-small ${vocab.learned ? 'marked' : ''}" onclick="toggleLearned('${vocab.id}')">
                    ${vocab.learned ? '✓ 習得済み' : '習得マーク'}
                </button>
                <button class="btn-small" onclick="startEditVocab('${vocab.id}')">編集</button>
                <button class="btn-small" onclick="deleteVocab('${vocab.id}')">削除</button>
            </div>
        </div>
    `;
}

function renderVocabularyEditForm(vocab) {
    return `
        <div class="add-vocab-form vocabulary-edit-form">
            <h3>語彙を編集</h3>
            <div class="form-grid">
                <div class="form-group">
                    <label>日本語</label>
                    <input type="text" id="edit-vocab-word-${vocab.id}" value="${escapeHtml(vocab.word)}">
                </div>
                <div class="form-group">
                    <label>よみがな</label>
                    <input type="text" id="edit-vocab-reading-${vocab.id}" value="${escapeHtml(vocab.reading || '')}">
                </div>
            </div>
            <div class="form-group">
                <label>意味（英語 / 中国語など）</label>
                <input type="text" id="edit-vocab-meaning-${vocab.id}" value="${escapeHtml(vocab.meaning)}">
            </div>
            <div class="form-group">
                <label>例文</label>
                <textarea id="edit-vocab-example-${vocab.id}">${escapeHtml(vocab.example || '')}</textarea>
            </div>
            <div class="form-group">
                <label>使用場景</label>
                <textarea id="edit-vocab-scenario-${vocab.id}">${escapeHtml(vocab.scenario || '')}</textarea>
            </div>
            <button class="btn-submit" onclick="saveEditVocab('${vocab.id}')">保存</button>
            <button class="btn-cancel" onclick="cancelEditVocab()">キャンセル</button>
        </div>
    `;
}

function renderProfileTab() {
    return `
        <h1>プロフィール</h1>
        <div class="user-profile">
            <div class="profile-field">
                <label>メールアドレス</label>
                <input type="email" value="${escapeHtml(appState.user.email)}" disabled>
            </div>
            <div class="profile-field">
                <label>ユーザー名</label>
                <input type="text" id="profile-username" value="${escapeHtml(appState.userProfile?.username || '')}">
            </div>
            <div class="profile-field">
                <label>自己紹介</label>
                <textarea id="profile-bio" style="width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: 0.5rem; background-color: var(--bg-tertiary); color: var(--text-primary); min-height: 100px;">${escapeHtml(appState.userProfile?.bio || '')}</textarea>
            </div>
            <button class="btn-update-profile" onclick="updateUserProfile()">プロフィール更新</button>

            <div class="danger-zone">
                <h3>危険ゾーン</h3>
                <button class="btn-delete-account" onclick="confirmDeleteAccount()">アカウント削除</button>
            </div>
        </div>
    `;
}

function renderAddVocabForm() {
    return `
        <div class="add-vocab-form">
            <h3>新しい語彙を追加</h3>
            <div class="form-grid">
                <div class="form-group">
                    <label>日本語</label>
                    <input type="text" id="add-vocab-word" placeholder="例: 提案">
                </div>
                <div class="form-group">
                    <label>よみがな</label>
                    <input type="text" id="add-vocab-reading" placeholder="例: ていあん">
                </div>
            </div>
            <div class="form-group">
                <label>意味（英語 / 中国語など）</label>
                <input type="text" id="add-vocab-meaning" placeholder="例: Proposal / Suggestion">
            </div>
            <div class="form-group">
                <label>例文</label>
                <textarea id="add-vocab-example" placeholder="例: 良い提案があります。"></textarea>
            </div>
            <div class="form-group">
                <label>使用場景</label>
                <textarea id="add-vocab-scenario" placeholder="例: ビジネス会議で新しいアイデアを提案する時に使う"></textarea>
            </div>
            <button class="btn-submit" onclick="submitAddVocab()">追加</button>
            <button class="btn-cancel" onclick="toggleAddVocabForm()">キャンセル</button>
        </div>
    `;
}

// ================== イベントハンドラー ==================
function toggleAuthForm() {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    loginForm.classList.toggle('hidden');
    signupForm.classList.toggle('hidden');
}

async function handleLogin() {
    appState.error = null;
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        appState.error = 'メールアドレスとパスワードを入力してください';
        renderApp();
        return;
    }

    try {
        const response = await supabase.auth_signInWithPassword(email, password);
        localStorage.setItem('sb-session', JSON.stringify(response));
        appState.user = response.user;
        await loadUserData();
        renderApp();
    } catch (err) {
        appState.error = err.message;
        renderApp();
    }
}

async function handleSignup() {
    appState.error = null;
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const passwordConfirm = document.getElementById('signup-password-confirm').value;

    if (!email || !password || !passwordConfirm) {
        appState.error = 'すべてのフィールドを入力してください';
        renderApp();
        return;
    }

    if (password !== passwordConfirm) {
        appState.error = 'パスワードが一致しません';
        renderApp();
        return;
    }

    if (password.length < 8) {
        appState.error = 'パスワードは8文字以上である必要があります';
        renderApp();
        return;
    }

    try {
        await supabase.auth_signUp(email, password);
        appState.error = null;
        // 自動ログイン
        const response = await supabase.auth_signInWithPassword(email, password);
        localStorage.setItem('sb-session', JSON.stringify(response));
        appState.user = response.user;
        await loadUserData();
        renderApp();
    } catch (err) {
        appState.error = err.message;
        renderApp();
    }
}

function handleOAuthGoogle() {
    supabase.auth_signInWithOAuth('google');
}

function handleOAuthGitHub() {
    supabase.auth_signInWithOAuth('github');
}

async function handleLogout() {
    if (appState.practice.isRecording) {
        stopRecording();
    }
    await supabase.auth_signOut();
    localStorage.removeItem('sb-session');
    appState.user = null;
    appState.vocabularies = [];
    appState.currentTab = 'home';
    appState.practice = createInitialPracticeState();
    appState.editingVocabId = null;
    renderApp();
}

function switchTab(tab) {
    appState.currentTab = tab;
    renderApp();
}

function switchLearnSubTab(tab) {
    appState.learnSubTab = tab;
    renderApp();
}

function generatePracticeScenario() {
    const industry = document.getElementById('setup-industry').value.trim();
    const scenarioType = document.getElementById('setup-scenario-type').value;
    const difficulty = document.getElementById('setup-difficulty').value;

    appState.practice.formParams = { industry, scenarioType, difficulty };

    // TODO: 実際のAI連携時は generate_scenario ステージのLLM API呼び出しに置き換える
    const scenario = mockGenerateScenario({ industry, scenarioType, difficulty });

    appState.practice.scenario = scenario;
    appState.practice.remainingSeconds = scenario.time_limit_seconds;
    appState.practice.transcript = '';
    appState.practice.feedback = null;
    appState.practice.duration = 0;
    appState.practice.addedSuggestions = {};
    renderApp();
}

function updatePracticeTranscript(value) {
    appState.practice.transcript = value;
    const submitBtn = document.querySelector('.practice-actions .btn-primary');
    if (submitBtn) {
        submitBtn.disabled = !value.trim();
    }
}

function startRecording() {
    const p = appState.practice;
    if (!isSpeechRecognitionSupported()) return;

    const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionClass();
    recognition.lang = 'ja-JP';
    recognition.continuous = true;
    recognition.interimResults = true;

    let finalTranscript = p.transcript || '';

    recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const text = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalTranscript += text;
            } else {
                interim += text;
            }
        }
        p.transcript = finalTranscript + interim;
        const textarea = document.getElementById('practice-transcript');
        if (textarea) textarea.value = p.transcript;
    };

    recognition.onerror = (event) => {
        showToast(`音声認識エラー: ${event.error}`, 'error');
        stopRecording();
    };

    recognition.onend = () => {
        if (p.isRecording) {
            stopRecording();
        }
    };

    p.recognition = recognition;
    p.isRecording = true;
    p.startTime = Date.now();
    recognition.start();

    p.timerInterval = setInterval(() => {
        p.remainingSeconds -= 1;
        const timerEl = document.getElementById('timer-display');
        if (timerEl) timerEl.textContent = formatTime(p.remainingSeconds);
        if (p.remainingSeconds <= 0) {
            stopRecording();
        }
    }, 1000);

    renderApp();
}

function stopRecording() {
    const p = appState.practice;
    if (p.recognition) {
        p.recognition.onend = null;
        p.recognition.stop();
        p.recognition = null;
    }
    if (p.timerInterval) {
        clearInterval(p.timerInterval);
        p.timerInterval = null;
    }
    if (p.isRecording && p.startTime) {
        p.duration = Math.max(1, Math.round((Date.now() - p.startTime) / 1000));
    }
    p.isRecording = false;
    renderApp();
}

async function submitForAnalysis() {
    const p = appState.practice;
    if (!p.transcript.trim()) return;

    p.isAnalyzing = true;
    renderApp();

    // TODO: 実際のAI連携時は analyze_response ステージのLLM API呼び出しに置き換える
    await new Promise(resolve => setTimeout(resolve, 600));
    const duration = p.duration || 1;
    const feedback = mockAnalyzeResponse(p.scenario, p.transcript, duration);

    p.feedback = feedback;
    p.isAnalyzing = false;
    renderApp();
}

function retryPractice() {
    const p = appState.practice;
    p.transcript = '';
    p.feedback = null;
    p.duration = 0;
    p.remainingSeconds = p.scenario.time_limit_seconds;
    p.addedSuggestions = {};
    renderApp();
}

function resetPractice() {
    if (appState.practice.isRecording) {
        stopRecording();
    }
    appState.practice = createInitialPracticeState();
    renderApp();
}

async function addSuggestionToWordbook(index) {
    const p = appState.practice;
    const suggestion = p.feedback.vocabulary_feedback.suggestions[index];
    if (!suggestion || !suggestion.addable_to_wordbook) return;

    if (appState.vocabularies.some(v => v.word === suggestion.improved)) {
        p.addedSuggestions[index] = true;
        showToast('この表現は既に単語帳にあります', 'warning');
        renderApp();
        return;
    }

    try {
        const newVocab = {
            user_id: appState.user.id,
            word: suggestion.improved,
            reading: '',
            meaning: suggestion.reason,
            example: p.feedback.polished_version,
            scenario: p.scenario.scenario_title,
            learned: false,
            created_at: new Date().toISOString(),
        };

        const result = await supabase.from('vocabularies').insert([newVocab]);
        if (result[0]) {
            newVocab.id = result[0].id;
            appState.vocabularies.push(newVocab);
        }
        p.addedSuggestions[index] = true;
        showToast('単語帳に追加しました', 'success');
        renderApp();
    } catch (err) {
        if (err.status === 409) {
            // 既に同じ単語が登録済み（一意制約違反）。エラーではなく追加済み扱いにする。
            p.addedSuggestions[index] = true;
            showToast('この表現は既に単語帳にあります', 'warning');
            renderApp();
            return;
        }
        showToast(`単語帳への追加に失敗しました: ${err.message}`, 'error');
    }
}

function toggleTheme() {
    const htmlElement = document.documentElement;
    const currentScheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const newScheme = currentScheme === 'dark' ? 'light' : 'dark';
    
    // CSS変数を手動で更新（見た目を即座に変更）
    if (newScheme === 'dark') {
        document.documentElement.style.colorScheme = 'dark';
    } else {
        document.documentElement.style.colorScheme = 'light';
    }
}

function toggleAddVocabForm() {
    const container = document.getElementById('add-vocab-form-container');
    if (container.innerHTML) {
        container.innerHTML = '';
    } else {
        container.innerHTML = renderAddVocabForm();
    }
}

async function submitAddVocab() {
    const word = document.getElementById('add-vocab-word').value.trim();
    const reading = document.getElementById('add-vocab-reading').value.trim();
    const meaning = document.getElementById('add-vocab-meaning').value.trim();
    const example = document.getElementById('add-vocab-example').value.trim();
    const scenario = document.getElementById('add-vocab-scenario').value.trim();

    if (!word || !meaning) {
        showToast('日本語と意味は必須です', 'error');
        return;
    }

    if (appState.vocabularies.some(v => v.word === word)) {
        showToast('この単語は既に登録されています', 'warning');
        return;
    }

    try {
        const newVocab = {
            user_id: appState.user.id,
            word,
            reading,
            meaning,
            example: example || null,
            scenario: scenario || null,
            learned: false,
            created_at: new Date().toISOString(),
        };

        const result = await supabase.from('vocabularies').insert([newVocab]);

        if (result[0]) {
            newVocab.id = result[0].id;
            appState.vocabularies.push(newVocab);
            appState.currentTab = 'learn';
            showToast('単語を追加しました', 'success');
            renderApp();
        }
    } catch (err) {
        if (err.status === 409) {
            showToast('この単語は既に登録されています', 'warning');
            return;
        }
        showToast(`語彙の追加に失敗しました: ${err.message}`, 'error');
    }
}

async function toggleLearned(vocabId) {
    const vocab = appState.vocabularies.find(v => v.id === vocabId);
    if (!vocab) return;

    try {
        await supabase.from('vocabularies').update({ learned: !vocab.learned, id: vocabId });
        vocab.learned = !vocab.learned;
        showToast(vocab.learned ? '習得済みにしました' : '未習得に戻しました', 'success');
        renderApp();
    } catch (err) {
        showToast(`状態の更新に失敗しました: ${err.message}`, 'error');
    }
}

function startEditVocab(vocabId) {
    appState.editingVocabId = vocabId;
    renderApp();
}

function cancelEditVocab() {
    appState.editingVocabId = null;
    renderApp();
}

async function saveEditVocab(vocabId) {
    const word = document.getElementById(`edit-vocab-word-${vocabId}`).value.trim();
    const reading = document.getElementById(`edit-vocab-reading-${vocabId}`).value.trim();
    const meaning = document.getElementById(`edit-vocab-meaning-${vocabId}`).value.trim();
    const example = document.getElementById(`edit-vocab-example-${vocabId}`).value.trim();
    const scenario = document.getElementById(`edit-vocab-scenario-${vocabId}`).value.trim();

    if (!word || !meaning) {
        showToast('日本語と意味は必須です', 'error');
        return;
    }

    if (appState.vocabularies.some(v => v.id !== vocabId && v.word === word)) {
        showToast('この単語は既に登録されています', 'warning');
        return;
    }

    try {
        await supabase.from('vocabularies').update({
            id: vocabId,
            word,
            reading,
            meaning,
            example: example || null,
            scenario: scenario || null,
        });

        const vocab = appState.vocabularies.find(v => v.id === vocabId);
        if (vocab) {
            Object.assign(vocab, { word, reading, meaning, example: example || null, scenario: scenario || null });
        }
        appState.editingVocabId = null;
        showToast('語彙を更新しました', 'success');
        renderApp();
    } catch (err) {
        if (err.status === 409) {
            showToast('この単語は既に登録されています', 'warning');
            return;
        }
        showToast(`更新に失敗しました: ${err.message}`, 'error');
    }
}

async function deleteVocab(vocabId) {
    if (!confirm('この語彙を削除しますか？')) return;

    try {
        await supabase.from('vocabularies').delete(vocabId);
        appState.vocabularies = appState.vocabularies.filter(v => v.id !== vocabId);
        showToast('削除しました', 'success');
        renderApp();
    } catch (err) {
        showToast(`削除に失敗しました: ${err.message}`, 'error');
    }
}

async function updateStudyGoal() {
    const goalInput = document.getElementById('goal-input');
    const goal = parseInt(goalInput.value, 10);

    if (isNaN(goal) || goal < 1) {
        showToast('有効な目標値を入力してください', 'error');
        return;
    }

    try {
        await supabase.from('user_profiles').update({
            study_goal: goal,
            user_id: appState.user.id,
        }, 'user_id');
        appState.studyGoal = goal;
        showToast('学習目標を更新しました', 'success');
        renderApp();
    } catch (err) {
        showToast(`目標の更新に失敗しました: ${err.message}`, 'error');
    }
}

async function updateUserProfile() {
    const username = document.getElementById('profile-username').value;
    const bio = document.getElementById('profile-bio').value;

    try {
        if (appState.userProfile) {
            await supabase.from('user_profiles').update({
                username,
                bio,
                user_id: appState.user.id,
            }, 'user_id');
        } else {
            await supabase.from('user_profiles').insert([{
                user_id: appState.user.id,
                username,
                bio,
                study_goal: appState.studyGoal,
            }]);
        }

        appState.userProfile = { username, bio, study_goal: appState.studyGoal };
        showToast('プロフィールを更新しました', 'success');
        renderApp();
    } catch (err) {
        showToast(`プロフィール更新に失敗しました: ${err.message}`, 'error');
    }
}

function confirmDeleteAccount() {
    if (confirm('本当にアカウントを削除しますか？この操作は取り消せません。')) {
        deleteAccount();
    }
}

async function deleteAccount() {
    try {
        // ユーザーデータを削除（RLSで自動的に自分のデータのみ削除）
        await supabase.from('vocabularies').delete(appState.user.id, 'user_id');
        await supabase.from('user_profiles').delete(appState.user.id, 'user_id');

        // Supabaseのユーザー削除（ここは制限される可能性があるため注意）
        await handleLogout();
        showToast('アカウントを削除しました', 'success');
    } catch (err) {
        showToast(`削除に失敗しました: ${err.message}`, 'error');
    }
}

// ================== ユーティリティ関数 ==================
function showToast(message, type = 'success', duration = 2600) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

function calculateStudyDays() {
    // 簡易実装：語彙が1つ以上あれば1日と計算
    return appState.vocabularies.length > 0 ? Math.ceil(appState.vocabularies.length / 5) : 0;
}

async function loadUserData() {
    try {
        appState.isLoading = true;
        renderApp();

        // ユーザープロフィール取得（無い場合は自動作成。vocabulariesのRLSポリシーが
        // user_profilesに本人の行が存在することを前提にしているため、ここで保証する）
        let profiles = await supabase.from('user_profiles').select('*');
        if (profiles.length === 0) {
            profiles = await supabase.from('user_profiles').insert([{
                user_id: appState.user.id,
                study_goal: 0,
            }]);
        }
        if (profiles.length > 0) {
            appState.userProfile = profiles[0];
            appState.studyGoal = profiles[0].study_goal || 0;
        }

        // 語彙一覧取得
        const vocabs = await supabase.from('vocabularies').select('*');
        appState.vocabularies = vocabs || [];

        appState.isLoading = false;
        renderApp();
    } catch (err) {
        appState.isLoading = false;
        renderApp();
        showToast(`データ読み込みに失敗しました: ${err.message}`, 'error');
    }
}

// ================== 初期化 ==================
async function initializeApp() {
    try {
        // セッション復元
        await supabase.auth_restoreSession();
        if (supabase.user) {
            appState.user = supabase.user;
            await loadUserData();
        }
        renderApp();
    } catch (err) {
        console.error('初期化エラー:', err);
        renderApp();
    }
}

// ページロード時に初期化
document.addEventListener('DOMContentLoaded', initializeApp);