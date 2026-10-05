# Corporate 04 게임 통합

기존 24 × 23m 보안 실습실을 회사형 SOC로 교체한다. 팀 단위 업무석 25개,
SOC 관리자석 1개, 관리자 모니터 5개와 대형 상태 화면, 네트워크 벤치 2개,
서버랙 6개를 포함한다. 기존 학습 미션과 저장 형식은 변경하지 않는다.

## 에셋과 기능

- `assets/authoring/Security_Lab_Corporate_04.blend`: 재질과 이미지가 패킹된 Blender 5.2.2 원본.
- `assets/models/security_lab.glb`: 게임이 직접 사용하는 독립 GLB. Git LFS로 관리한다.
- `assets/models/security_lab.json`: 내보내기 통계와 디코딩 검사용 해시.
- `assets/models/security_lab_functional.json`: 기존 76개 기능 오브젝트의 보존 기준.

일반 시각 geometry는 6,968,337 삼각형을 유지한다. 이미지 52개가 GLB 내부에
원본 해상도로 포함되어 있다. Blender의 절차적 bump는 glTF가 지원하는 스캔
노멀 맵으로 연결한다. glTF 재질과 실시간 조명은 Cycles 렌더와 동일한 결과를
보장하지 않는다. 원본 Blender 파일은 변경하지 않는다.

Meshopt로 시각 float 속성을 18-bit exponential mantissa로 인코딩한다.
삼각형을 줄이지 않으며, 원래 인덱스 순서와 문·충돌 geometry는 무손실이다.
전체 시각 속성을 원본과 비교한 최대 위치 오차는 약 0.061mm이며,
검사 허용 범위는 0.2mm다.
반복 에셋의 데이터는 중복 제거하며 런타임에서도 인스턴스로 사용한다.
고유 geometry는 indexed 상태로 공간별 작은 배치로 묶는다. 보이지 않는
배치 전 geometry는 상호작용 raycast에서 제외한다. 상호작용과 문의 자식
geometry는 별도로 유지한다.

`INTERACT_*`, `DOOR_*`, `COLLIDER_*`, `SPAWN_*` 기존 76개 이름·world transform·
문 bounds·상호작용 속성을 검사한다. 총 89개 collider가 새 가구를 포함한다.
게임에서 실제 걷기·문 회전·장비 접근·미션·저장·실패 후 복구를 검사한다.

고품질 PC 환경을 우선한다. 첫 진입 시 약 184.6MB GLB를 읽으며, 크기 상한은
256MiB, 준비 제한 시간은 20초다. WebGL 오류 또는 시간 초과 시 기존 2D
실습으로 이어갈 수 있다. 저사양 PC와 소프트웨어 렌더러의 성능은 별도 측정한다.

## 재내보내기

Git LFS 설치 후 `git lfs pull`을 실행한다. Windows에서 Blender 5.2 이상으로:

```powershell
blender --background assets/authoring/Security_Lab_Corporate_04.blend --python scripts/export_corporate_lab.py -- build/corporate-unpacked.glb
python scripts/pack_corporate_lab.py build/corporate-unpacked.glb assets/models/security_lab.glb --blender-dir 'C:/Program Files/Blender Foundation/Blender 5.2'
node scripts/verify_corporate_precision.js build/corporate-unpacked.glb assets/models/security_lab.glb
npm run vendor -- --check
npm run check
```

pack 단계는 Blender에 포함된 meshoptimizer encoder를 사용한다. 이미지 리사이즈와
재압축은 하지 않는다. CI와 Windows 패키징은 LFS를 내려받고, 패키징은 같은
런타임 허용 목록에 있는 GLB·decoder·환경 조명을 모두 포함한다.

## 보안 및 출처

decoder는 로컬 Three.js 0.186.1에 포함된 Meshoptimizer 1.1이다. 내장된 WASM
바이트를 위해 CSP에 `wasm-unsafe-eval`만 허용한다. JavaScript 문자열 실행을
허용하는 `unsafe-eval`과 임의 inline script는 계속 금지한다. 원격 다운로드,
실제 IP 요청, 사용자 입력 기반 네트워크 접근은 추가하지 않는다.

- [Meshopt glTF 규격](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Vendor/EXT_meshopt_compression)
- [WASM 전용 CSP 설명](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src#unsafe_webassembly_execution)
- [에셋 출처](CORPORATE_ASSET_CREDITS.md): CC BY 의자 크레딧을 포함하며 EXE와 웹 패키지에도 `assets/credits.txt`로 배포한다.
