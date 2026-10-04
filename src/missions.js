export const MISSIONS = [
  {
    id: 'tutorial', title: '조사 준비', subtitle: '허용된 범위부터 확인하세요', duration: '약 5분', boundary: '모든 대상은 게임 내부 가상 데이터입니다.',
    clues: { help: { label: '게임 명령 사용법', command: 'help' }, approval: { label: '승인된 조사 범위', command: 'inspect approval' } },
    quickCommands: ['help', 'inspect approval', 'verify'],
    defenseGuidance: '승인된 조사 범위를 선택하세요.', comparisonGuidance: '다음 미션부터 조사와 방어 이후 결과를 비교합니다.',
    objective: 'help와 inspect로 승인서를 읽고, 허용된 조사 범위를 선택하세요.',
    commands: ['help', 'inspect', 'verify'],
    hints: ['조사 전에 대상과 권한을 확인해야 합니다.', 'help 다음에 inspect approval을 입력하세요.', '승인서 확인 후 「club-server의 가상 데이터만 조사」를 선택하고 verify를 입력하세요.'],
    answers: ['club-server의 가상 데이터만 조사', '인터넷의 모든 학교 서버 조사', '아무 IP나 조사'], correct: 0,
    evidence: ['help', 'approval'], investigation: 'help와 inspect approval로 사용법과 승인 범위를 확인하세요.',
    answerFeedback: ['승인서에 적힌 조사 범위와 일치합니다. verify로 조사 준비를 확인하세요.', '학교 서버라는 이유만으로 조사 권한이 생기지는 않습니다. inspect approval에서 승인된 대상을 다시 확인하세요.', '대상과 행위의 승인이 먼저 필요합니다. inspect approval에서 조사 범위를 확인하세요.'],
    explanation: '승인은 대상과 행위의 범위를 함께 정합니다. 여기서는 게임 내부의 club-server만 조사합니다.',
  },
  {
    id: 'services', title: '노출된 서비스', subtitle: '자료 서비스는 계속 운영되어야 합니다', duration: '8–12분', boundary: '포트 조회·방화벽·접속 테스트는 시뮬레이션입니다. 실제 요청은 없습니다.',
    clues: { scan: { label: '서비스 포트 목록', command: 'scan club-server' }, 'port-443': { label: '자료 서비스 운영 조건', command: 'inspect club-server 443' }, 'port-8080': { label: '관리 서비스가 불필요함', command: 'inspect club-server 8080' }, rescan: { label: '방어 후 포트 재조회', command: 'scan club-server' } },
    quickCommands: ['scan club-server', 'inspect club-server 443', 'inspect club-server 8080', 'verify'],
    defenseGuidance: '방어 설정에서 필요한 자료 서비스는 유지하고 불필요한 접근을 제한하세요.', comparisonGuidance: 'scan club-server로 조사하고, 설정 변경 후 다시 scan과 재검증을 실행하세요.',
    objective: '서비스의 용도를 조사하고 불필요한 관리 포트만 차단하세요. 자료 서비스의 정상 동작도 재검증해야 합니다.',
    commands: ['help', 'inspect', 'scan', 'verify'],
    hints: ['열린 포트 자체가 취약점은 아닙니다. 운영 목적을 확인하세요.', 'scan club-server와 inspect club-server 8080으로 단서를 모으세요.', '443은 허용하고 8080만 차단한 뒤 scan club-server, verify를 차례로 실행하세요.'],
    answers: ['열린 포트는 모두 취약하므로 전부 차단', '사용하지 않는 관리 서비스의 접근이 허용되어 있음', 'HTTPS 자료 서비스는 항상 위험함'], correct: 1,
    evidence: ['scan', 'port-8080'], investigation: 'scan club-server와 inspect club-server 8080으로 상태와 서비스 용도를 확인하세요.',
    answerFeedback: ['열린 포트만으로 위험을 판단할 수는 없습니다. inspect club-server 443으로 자료 열람에 필요한 서비스를 확인하세요.', '조사한 서비스 용도와 일치합니다. 불필요한 접근을 제한하고 자료 서비스도 정상인지 재검증하세요.', 'HTTPS 서비스의 존재만으로 위험하다고 단정할 수는 없습니다. inspect club-server 443과 inspect club-server 8080으로 운영 목적을 비교하세요.'],
    explanation: '필수 HTTPS 서비스(443)는 유지하고 사용하지 않는 관리 서비스(8080)의 접근을 제한했습니다. 방화벽 차단은 프로세스 종료와 다릅니다.',
  },
  {
    id: 'login', title: '약한 로그인 정책', subtitle: '정상 사용자는 들어올 수 있어야 합니다', duration: '8–12분', boundary: '더미 계정·후보 대입·로그인 결과는 시뮬레이션입니다. 실제 비밀번호는 입력하지 않습니다.',
    clues: { login: { label: '더미 후보와 시도 기록', command: 'inspect login' } },
    quickCommands: ['inspect login', 'verify'],
    defenseGuidance: '방어 설정에서 길이·흔한 값·반복 시도 정책을 확인하세요.', comparisonGuidance: '정책 변경 후 inspect login 또는 재검증으로 정상 로그인과 반복 실패를 비교하세요.',
    objective: '더미 후보와 기록을 살펴보고 길이·흔한 값 차단·시도 제한을 적용하세요. 정상 로그인과 반복 실패를 함께 확인하세요.',
    commands: ['help', 'inspect', 'verify'],
    hints: ['특수문자가 있어도 짧고 흔한 값은 안전하다고 단정할 수 없습니다.', 'inspect login으로 후보와 시도 기록을 확인하세요.', '최소 길이 15, 흔한 값 차단, 3회 시도 제한을 적용하고 verify를 입력하세요.'],
    answers: ['특수문자를 하나 붙이면 충분히 안전함', 'SHA-256으로 저장하면 모든 공격을 막을 수 있음', '짧고 흔한 값이 허용되고 반복 시도 제한이 없음'], correct: 2,
    evidence: ['login'], investigation: 'inspect login으로 더미 후보와 반복 실패 기록을 확인하세요.',
    answerFeedback: ['password!처럼 기호가 있어도 짧고 흔한 값일 수 있습니다. inspect login에서 후보 허용 여부와 반복 실패 기록을 비교하세요.', 'SHA-256은 반복 로그인 시도를 제한하지 않으며 비밀번호 저장에는 전용 방식이 필요합니다. inspect login에서 길이·흔한 값·시도 제한을 확인하세요.', '더미 후보와 반복 실패 기록에 맞는 설명입니다. 정책을 적용한 뒤 정상 사용자와 반복 실패를 함께 재검증하세요.'],
    explanation: '이 미션은 길이 15 이상, 흔한 값 차단, 연속 실패 3회 후 제한을 사용합니다. 문자 종류 혼합만 강제하지 않습니다. 정책 변경이 기존 비밀번호를 자동 변경하지는 않으며, 여기서는 새 정책의 후보 검사를 시뮬레이션합니다.',
  },
  {
    id: 'integrity', title: '변조된 자료', subtitle: '신뢰할 수 있는 기준과 비교하세요', duration: '8–12분', boundary: '내장 파일 바이트의 SHA-256은 브라우저 Web Crypto로 실제 계산합니다.',
    clues: { baseline: { label: '승인된 오프라인 기준', command: 'inspect baseline' }, hash: { label: 'SHA-256 비교 결과', command: 'hash files' }, mismatch: { label: 'budget.csv 변경 감지', command: 'hash files' } },
    quickCommands: ['inspect baseline', 'hash files', 'verify'],
    defenseGuidance: '방어 설정에서 변경된 파일을 승인된 원본으로 복구하세요.', comparisonGuidance: '복구 후 hash files를 다시 실행해야 변경 후 결과를 비교할 수 있습니다.',
    objective: '승인된 오프라인 원본 기준을 확인하고 세 파일의 해시를 비교하세요. 변경된 파일을 골라 복구하고 다시 검증하세요.',
    commands: ['help', 'inspect', 'hash', 'verify'],
    hints: ['해시 비교에는 신뢰할 수 있는 기준값이 필요합니다.', 'inspect baseline과 hash files로 세 파일을 비교하세요.', 'budget.csv를 선택해 원본으로 복구하고 hash files 다음 verify를 실행하세요.'],
    answers: ['해시가 다르면 반드시 악성코드임', '신뢰 가능한 기준과 다르므로 파일 바이트가 변경됨', '해시가 같으면 작성자의 신원까지 보장됨'], correct: 1,
    evidence: ['baseline', 'hash', 'mismatch'], investigation: 'inspect baseline과 hash files로 신뢰 기준과 변경된 파일을 확인하세요.',
    answerFeedback: ['해시 불일치는 바이트가 바뀌었다는 뜻이며 악성 여부를 판정하지 않습니다. 파일 비교에서 현재 값과 신뢰 기준을 다시 살펴보세요.', '신뢰 기준과 해시 비교 결과에 맞는 설명입니다. 변경된 파일을 복구한 뒤 해시를 다시 계산하고 재검증하세요.', '해시 일치는 비교한 바이트를 확인할 뿐 작성자의 신원을 인증하지 않습니다. inspect baseline으로 비교 기준을 신뢰하는 이유를 확인하세요.'],
    explanation: '다른 SHA-256은 바이트 변경을 뜻하며 악성 여부를 판정하지 않습니다. 일치는 신뢰 가능한 기준과 같은 바이트임을 확인할 뿐 작성자를 인증하지 않습니다. 비밀번호 저장에는 단순 SHA-256 대신 Argon2id 등의 전용 방식이 필요합니다.',
  },
];

export const LEGACY_MISSION_IDS = Object.freeze(['tutorial', 'services', 'login', 'integrity']);
export const MISSION_INDEX = Object.freeze(Object.fromEntries(MISSIONS.map((mission, index) => [mission.id, index])));

export const ORIGINAL_FILES = Object.freeze({
  'notice.txt': '동아리 모임: 금요일 16시, 컴퓨터실\n',
  'budget.csv': 'item,amount\nbooks,30000\nsnacks,10000\n',
  'members.txt': 'student-alpha\nstudent-beta\nstudent-gamma\n',
});
export const TAMPERED_BUDGET = 'item,amount\nbooks,90000\nsnacks,10000\n';
export const COMMON_PASSWORDS = ['password', 'password!', '123456', 'club2026', 'school-club-password'];
export const NORMAL_PASSWORD = 'reading-stars-in-autumn';
