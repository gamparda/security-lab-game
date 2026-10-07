extends Node3D

var missions: LabMissions
var player: LabPlayer
var world: LabWorld
var ui: LabUI
var equipment: LabEquipment
var saves = LabSave.new()
var save_timer: Timer
var startup_usec = Time.get_ticks_usec()
var loaded_ms = 0.0
var qa_mode = false
var settings: LabSettings
var bindings = LabInputBindings.new()

func _ready():
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--qa"): qa_mode = true
	setup_input()
	missions = LabMissions.new()
	missions.name = "MissionManager"
	add_child(missions)
	if qa_mode: saves.directory = "user://qa"
	DirAccess.make_dir_recursive_absolute(saves.directory)
	var load_status = saves.load_into(missions) if not qa_mode else "검증용 새 조사"
	player = LabPlayer.new()
	player.name = "Player"
	add_child(player)
	world = LabWorld.new()
	world.name = "World"
	add_child(world)
	world.setup(missions,player)
	equipment = LabEquipment.new()
	equipment.name = "DeviceManager"
	add_child(equipment)
	equipment.setup(world,missions)
	ui = LabUI.new()
	ui.name = "UIManager"
	add_child(ui)
	ui.setup(missions,player,load_status)
	settings = LabSettings.new()
	settings.name = "Settings"
	add_child(settings)
	settings.setup(self)
	var audio = preload("res://scripts/audio.gd").new()
	audio.name = "OfficeAudio"
	add_child(audio)
	audio.setup(self)
	player.inspect_requested.connect(func(target): target.inspect())
	player.tool_requested.connect(func(target): ui.open_tool(target.open_tool(),target.device_id))
	player.pause_requested.connect(ui.pause)
	ui.reset_position_requested.connect(player.respawn)
	ui.save_requested.connect(save_now)
	ui.import_requested.connect(import_progress)
	save_timer = Timer.new()
	save_timer.one_shot = true
	save_timer.wait_time = .4
	save_timer.timeout.connect(save_now)
	add_child(save_timer)
	missions.state_changed.connect(func(): save_timer.start())
	loaded_ms = (Time.get_ticks_usec()-startup_usec)/1000.0
	print("NATIVE_READY ",JSON.stringify({"godot":Engine.get_version_info().string,"load_ms":loaded_ms,"functional":world.protected_nodes.size(),"colliders":world.collider_count,"doors":world.doors.size(),"devices":world.devices.size(),"screens":equipment.screen_bindings,"leds":equipment.leds.size(),"renderer":RenderingServer.get_current_rendering_method()}))
	if qa_mode and "--qa-manual" not in OS.get_cmdline_user_args():
		var script = "res://tests/layout_review.gd" if "--qa-layout" in OS.get_cmdline_user_args() else "res://tests/ux_review.gd" if "--qa-ux" in OS.get_cmdline_user_args() else "res://tests/physical_slice.gd" if "--qa-physical" in OS.get_cmdline_user_args() or "--qa-nav" in OS.get_cmdline_user_args() else "res://tests/review.gd" if "--qa-review" in OS.get_cmdline_user_args() else "res://tests/vertical_slice.gd"
		var qa = load(script).new()
		add_child(qa)
		qa.run.call_deferred(self)

func save_now():
	ui.toast.text = "진행 저장 완료" if saves.save(missions) else saves.error_message

func import_progress(path: String):
	var file = FileAccess.open(path,FileAccess.READ)
	if file == null:
		ui.toast.text = "진행 파일을 열지 못했습니다."
		return
	if file.get_length() > 131072:
		ui.toast.text = "진행 파일은 128KiB 이하여야 합니다."
		file.close()
		return
	var text = file.get_as_text()
	file.close()
	if saves.decode(text,missions):
		missions.state_changed.emit()
		ui.toast.text = "웹 진행을 가져왔습니다. 위치·문 상태는 안전한 기본값을 사용합니다."
	else: ui.toast.text = "가져오기 실패 · " + saves.error_message

func setup_input():
	if qa_mode: bindings.path = "user://qa/input_bindings.json"
	DirAccess.make_dir_recursive_absolute(bindings.path.get_base_dir())
	bindings.load_profile()
	# Existing QA uses default physical keys and never reads a user's profile.
	if qa_mode: bindings.bindings = LabInputBindings.defaults(); bindings.apply()

func _notification(what):
	if what == NOTIFICATION_WM_CLOSE_REQUEST and missions != null:
		saves.save(missions)
		get_tree().quit()
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT and ui != null and not qa_mode:
		ui.open_tool("Notes")
