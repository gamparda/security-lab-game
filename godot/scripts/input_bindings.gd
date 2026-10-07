class_name LabInputBindings
extends RefCounted

signal changed

# Physical keyboard positions, matching the original native controls.
const ACTIONS = [
	{"id":"forward","label":"앞으로","defaults":[KEY_W]},
	{"id":"back","label":"뒤로","defaults":[KEY_S]},
	{"id":"left","label":"왼쪽","defaults":[KEY_A]},
	{"id":"right","label":"오른쪽","defaults":[KEY_D]},
	{"id":"sprint","label":"달리기","defaults":[KEY_SHIFT]},
	{"id":"crouch","label":"앉기","defaults":[KEY_CTRL,KEY_C]},
	{"id":"jump","label":"점프","defaults":[KEY_SPACE]},
	{"id":"inspect","label":"조사","defaults":[KEY_E]},
	{"id":"tool","label":"상세 도구","defaults":[KEY_F]},
	{"id":"pause","label":"일시정지 / 조사 노트","defaults":[KEY_ESCAPE]}
]
const SPECIAL_KEYS = [KEY_ESCAPE,KEY_TAB,KEY_BACKSPACE,KEY_ENTER,KEY_KP_ENTER,KEY_INSERT,KEY_DELETE,KEY_HOME,KEY_END,KEY_PAGEUP,KEY_PAGEDOWN,KEY_LEFT,KEY_RIGHT,KEY_UP,KEY_DOWN,KEY_SHIFT,KEY_CTRL,KEY_ALT,KEY_CAPSLOCK,KEY_KP_MULTIPLY,KEY_KP_DIVIDE,KEY_KP_SUBTRACT,KEY_KP_ADD,KEY_KP_PERIOD,KEY_KP_0,KEY_KP_1,KEY_KP_2,KEY_KP_3,KEY_KP_4,KEY_KP_5,KEY_KP_6,KEY_KP_7,KEY_KP_8,KEY_KP_9]
var bindings: Dictionary = defaults()
var path = "user://input_bindings.json"
var load_status = ""

static func defaults() -> Dictionary:
	var result = {}
	for action in ACTIONS: result[action.id] = action.defaults.duplicate()
	return result

static func label_for(id: String) -> String:
	for action in ACTIONS:
		if action.id == id: return action.label
	return "알 수 없는 액션"

static func valid_key(value) -> bool:
	if not (value is int or value is float) or not is_finite(float(value)) or value != int(value): return false
	var key = int(value)
	return key >= KEY_SPACE and key <= KEY_ASCIITILDE or key >= KEY_F1 and key <= KEY_F12 or key in SPECIAL_KEYS

static func validate(candidate) -> Dictionary:
	if not candidate is Dictionary or candidate.size() != ACTIONS.size(): return {"ok":false,"message":"조작키 목록이 올바르지 않습니다."}
	var seen = {}
	var canonical = {}
	for action in ACTIONS:
		var keys = candidate.get(action.id)
		if not keys is Array or keys.size() < 1 or keys.size() > 2: return {"ok":false,"message":action.label+"에 최소 한 개의 키가 필요합니다."}
		canonical[action.id] = []
		for key in keys:
			if not valid_key(key): return {"ok":false,"message":"지원하지 않는 키입니다."}
			key = int(key)
			if seen.has(key): return {"ok":false,"message":OS.get_keycode_string(key)+" 키는 이미 "+label_for(seen[key])+"에 사용 중입니다.","conflict":seen[key]}
			seen[key] = action.id
			canonical[action.id].append(key)
	return {"ok":true,"bindings":canonical}

func load_profile():
	bindings = defaults()
	load_status = ""
	if FileAccess.file_exists(path):
		var file = FileAccess.open(path,FileAccess.READ)
		var parsed = null
		if file != null:
			if file.get_length() <= 16384: parsed = JSON.parse_string(file.get_as_text())
			file.close()
		var result = validate(parsed.get("actions")) if parsed is Dictionary and parsed.get("schema") == 1 and parsed.get("mode") == "physical_keyboard" else {"ok":false}
		if result.ok: bindings = result.bindings
		else: load_status = "저장된 조작키가 올바르지 않아 기본값을 복구했습니다."
	apply()

func apply():
	for action in ACTIONS:
		if not InputMap.has_action(action.id): InputMap.add_action(action.id)
		Input.action_release(action.id)
		InputMap.action_erase_events(action.id)
		for key in bindings[action.id]:
			var event = InputEventKey.new()
			event.physical_keycode = key
			InputMap.action_add_event(action.id,event)
	changed.emit()

func replace_key(candidate: Dictionary, action: String, key: int) -> Dictionary:
	if not candidate.has(action) or not valid_key(key): return {"ok":false,"message":"지원하지 않는 키입니다. Windows 키와 키 조합은 사용할 수 없습니다."}
	var next = candidate.duplicate(true)
	next[action] = [key]
	return validate(next)

func save_profile(candidate: Dictionary) -> Dictionary:
	var result = validate(candidate)
	if not result.ok: return result
	var temporary = path+".tmp"
	var file = FileAccess.open(temporary,FileAccess.WRITE)
	if file == null: return {"ok":false,"message":"조작키를 저장하지 못했습니다 · "+error_string(FileAccess.get_open_error())}
	file.store_string(JSON.stringify({"schema":1,"mode":"physical_keyboard","actions":result.bindings},"\t"))
	file.flush()
	var error = file.get_error()
	file.close()
	if error == OK: error = DirAccess.rename_absolute(temporary,path)
	if error != OK:
		DirAccess.remove_absolute(temporary)
		return {"ok":false,"message":"조작키 저장에 실패했습니다 · "+error_string(error)}
	bindings = result.bindings
	load_status = ""
	apply()
	return {"ok":true,"message":"조작키를 적용하고 저장했습니다."}

static func names(keys: Array) -> String:
	var labels: PackedStringArray = []
	for key in keys: labels.append(OS.get_keycode_string(int(key)))
	return " / ".join(labels)

static func key_names(action: String) -> String:
	var keys = []
	if InputMap.has_action(action):
		for event in InputMap.action_get_events(action):
			if event is InputEventKey and event.physical_keycode != 0: keys.append(event.physical_keycode)
	return names(keys if not keys.is_empty() else defaults().get(action,[]))

static func hint(text: String) -> String:
	# Existing localized mission descriptions stay intact; displayed shortcuts
	# follow the same live InputMap as gameplay, including world placards.
	var movement = "/".join([key_names("forward"),key_names("back"),key_names("left"),key_names("right")])
	var tokens = {"WASD":"WASD" if movement == "W/S/A/D" else movement,"Shift":key_names("sprint"),"Ctrl·C":key_names("crouch"),"Space":key_names("jump"),"Esc":key_names("pause"),"E":key_names("inspect"),"F":key_names("tool")}
	var regex = RegEx.new()
	regex.compile("(?<![A-Za-z0-9_])(?:WASD|Shift|Ctrl·C|Space|Esc|E|F)(?![A-Za-z0-9_])")
	# One pass avoids replacing a newly bound key a second time (e.g. E -> F).
	var output = ""
	var offset = 0
	for match_token in regex.search_all(text):
		output += text.substr(offset,match_token.get_start()-offset)+tokens[match_token.get_string()]
		offset = match_token.get_end()
	return output+text.substr(offset)
