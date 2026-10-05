# Windows Chrome runtime

공식 환경: Windows 10/11 x64, 최신 Google Chrome Desktop, 키보드·마우스, 최소 1280×720 / 기준 1920×1080. 실행기는 Chrome을 직접 찾아 연다. 설치되지 않았다면 주소와 설치 안내를 표시한다. 모바일·터치·Edge·Firefox·WebKit 프로젝트와 터치 전용 진입 분기를 제거했다.

## 자산과 기능

`assets/authoring/Security_Lab_Corporate_04.blend`는 변경하지 않았다. SHA-256: `1f84b263405e2e9821b79962395dfa0d60bbde1f4ae0b92453b872b4487f6b68`.

게임용 GLB는 184,581,344 → 67,867,452 bytes, 근거리 전체 장면은 6,968,337 → 2,188,440 triangles다. 실제 병목이었던 서버랙·포트·케이블을 먼저 분석했다. Meshoptimizer가 1.2mm 기하 오차 안에서 근거리 표현을 만들고 4mm / 12mm 오차의 중·원거리 인덱스를 제공한다. triangle 목표 수를 지정하지 않는다. 재내보내기는 원본 고품질 GLB를 입력으로 `scripts/runtime-lod.mjs`, 이어서 `scripts/pack_corporate_lab.py`를 실행한다. 현재 기본 기능 도구와 재질·노드 구조를 유지한다.

101개의 INTERACT/DOOR/COLLIDER/SPAWN 인터페이스와 문·충돌의 98개 indexed geometry는 기존 파일과 정확히 비교했다. `security_lab_runtime_functional.json`은 최적화 전 스냅샷이다. 기존 76개의 월드 Transform/연결과 현재 89개 충돌 구조도 unit 검사한다. 시각 LOD가 바뀌어도 interaction raycast는 근거리 원본 geometry를 사용한다. Collider와 Door는 LOD 대상에서 제외한다.

## 도시와 유리

사용자가 제공한 도시 레퍼런스 이미지를 변형 없이 420m 거리의 원거리 전망에 사용한다. 약 48~250m의 두 구역에 60개의 실제 instanced 건물을 배치하고 강·교량·조명 geometry를 더했다. 사진·건물은 카메라와 함께 움직이지 않아 창가의 좌우 이동에서 서로 다른 parallax가 생긴다. 실내에는 원거리 사진과 직접 겹치는 창문용 2D overlay를 사용하지 않는다.

유리는 원본 두께 geometry와 물리 재질을 유지하면서 저렴한 투명 합성으로 변경했다. 도시 PMREM 반사, clearcoat, Fresnel과 약한 절차적 roughness 변화를 사용한다. 굴절을 위해 실내를 두 번 그리는 전체 transmission pass를 제거했다. 이 경로는 모든 GPU에서 동일하며 유리는 opaque occluder가 아니다. 정확한 물리 굴절·동적인 화면 공간 실내 반사는 구현하지 않았다.

## 렌더링과 visibility

Three.js 0.186.1 / WebGL2를 유지한다. [TAAUNode](https://threejs.org/docs/pages/TAAUNode.html)는 WebGPU/TSL 경로여서 기존 WebGL에 임의로 연결하지 않았다. [TAARenderPass](https://threejs.org/docs/pages/TAARenderPass.html)의 정지 화면 누적 원칙을 사용한 작은 자체 WebGL resolver다: 장면을 선택 해상도로 렌더링 → 정지 시 8개 jitter 샘플 누적 → 원래 화면 크기에 edge-clamped sharpen 재구성. 이동 중에는 이전 view를 섞지 않고 공간 재구성한다. camera/door/LOD/resize/preset 변경 시 history를 초기화한다. 모션 벡터 재투영 TAAU가 아니며 빠른 움직임의 subpixel 반짝임을 완전히 제거하지 못한다.

Native 100%, Ultra 85%, Quality 75%(기본), Balanced 60%, Performance 50%. HTML UI는 canvas 후처리 대상에서 제외해 native 해상도다. 고정 preset을 사용하며 dynamic resolution은 도입하지 않았다. F3 또는 `?debug=1`로 FPS / ms / calls / triangles / scale / backend / visible zones / LOD 정보를 표시한다.

MainOffice / SOC / ServerRoom / Network / Training / Forensics / Exterior로 구분한다. Frustum과 화면상 크기가 기준이며 현재 방만 표시하는 로직은 없다. 실제 불투명 벽의 충돌 bounds에 의해 object의 8개 world AABB 모서리가 모두 가려질 때만 보수적으로 occlusion cull한다. 유리·창문·문은 blocker에 포함하지 않는다. 화면상 geometry error에 0.85/1.15pixel hysteresis를 적용하고 작은 전체 props는 subpixel 크기에서만 숨긴다. 반복 mesh는 작은 공간 셀로 instancing하며 셀 전체를 한 장면 규모로 합치지 않는다.

## 검사와 CI

기존 Actions 기록: PR20의 Linux 검사 15분 4초, Windows artifact 15분 20초. Windows launcher 검사가 13분 9초였고 전체 Chromium+mobile 회귀, Edge 회귀, 3D 준비를 반복했다.

이제 Windows 하나에서 runtime LFS만 받으며 Blender master를 다운로드하지 않는다. npm/pip cache와 runner에 설치된 Chrome을 사용한다. core Node unit + Python server → PyInstaller → source-free native launcher/port/single-instance/version/restart → Chrome의 한 번의 3D first frame, 실제 WASD/충돌/문/관리 PC, tutorial와 save 복원 → artifact 순서다. 장거리 5개 장비 순회, 반복 scene startup/context/door E2E와 cross-browser·mobile 조합을 제거했다. 2D의 빠른 회귀는 로컬 `npm run check`에 남겼다. CI는 겹치는 동일 branch 실행을 취소한다. 실제 Actions 측정 결과는 PR와 별도 검증 보고서에 기록한다.

실행 환경마다 GPU가 달라 성능 수치를 일반화하지 않는다. 로컬 benchmark는 RTX 5060 Ti / D3D11 / Chrome 154.0.8037.93 / 1920×1080 기준이다. CI WARP는 기능 확인용이며 실제 GPU FPS의 근거가 아니다. 제공된 도시 이미지의 별도 배포 권리는 프로젝트 소유자가 확인해야 한다.
