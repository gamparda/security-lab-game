class_name LabSettings
extends Node

var values = {"resolution":0,"fullscreen":false,"vsync":true,"quality":1,"master":0.65,"sfx":0.55,"sensitivity":0.0018,"fov":72.0}
var game: Node
var panel: Window
var path = "user://settings.json"
var binding_draft: Dictionary = {}
var binding_buttons: Dictionary = {}
var binding_status: Label
var capture_action = ""
var capture_release_key = 0
var binding_cancel: Button
var binding_reset: Button
var apply_button: Button

func setup(root: Node):
	game = root
	if game.qa_mode: path = "user://qa/settings.json"
	var raw = JSON.parse_string(FileAccess.get_file_as_string(path)) if FileAccess.file_exists(path) else null
	if raw is Dictionary:
		for key in values:
			if raw.has(key) and (typeof(raw[key]) == typeof(values[key]) or (raw[key] is float or raw[key] is int) and not values[key] is bool): values[key] = raw[key]
	values.resolution = clampi(int(values.resolution),0,2)
	values.quality = clampi(int(values.quality),0,3)
	values.master = clampf(values.master,0,1)
	values.sfx = clampf(values.sfx,0,1)
	values.sensitivity = clampf(values.sensitivity,.0005,.004)
	values.fov = clampf(values.fov,60,90)
	if AudioServer.get_bus_index("SFX") == -1:
		AudioServer.add_bus()
		AudioServer.set_bus_name(AudioServer.bus_count-1,"SFX")
		AudioServer.set_bus_send(AudioServer.bus_count-1,"Master")
	apply()
	game.ui.settings_requested.connect(show_menu)
	game.bindings.changed.connect(func():
		game.ui.refresh_input_hints()
		for device in game.world.devices.values(): device.update_placard())

func apply():
	if DisplayServer.get_name() != "headless":
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN if values.fullscreen else DisplayServer.WINDOW_MODE_WINDOWED)
		if not values.fullscreen: DisplayServer.window_set_size([Vector2i(1600,900),Vector2i(1280,720),Vector2i(1920,1080)][values.resolution])
		DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED if values.vsync else DisplayServer.VSYNC_DISABLED)
	var quality = int(values.quality)
	var viewport = get_viewport()
	viewport.msaa_3d = [Viewport.MSAA_DISABLED,Viewport.MSAA_2X,Viewport.MSAA_4X,Viewport.MSAA_8X][quality]
	viewport.scaling_3d_scale = .8 if quality == 0 else 1.0
	var native_advanced = RenderingServer.get_current_rendering_method() == "forward_plus"
	var env = game.world.environment.environment
	env.ssao_enabled = native_advanced and quality >= 1
	env.ssao_radius = .6
	env.ssao_intensity = 1.35
	env.ssao_power = 1.4
	env.ssao_detail = .6
	env.ssr_enabled = false
	env.glow_enabled = native_advanced and quality >= 2
	env.glow_intensity = .15
	if game.world.has_node("OfficeReflection"): game.world.get_node("OfficeReflection").visible = native_advanced and quality >= 1
	AudioServer.set_bus_volume_db(0,linear_to_db(maxf(values.master,.0001)))
	AudioServer.set_bus_mute(0,values.master <= 0)
	var sfx = AudioServer.get_bus_index("SFX")
	AudioServer.set_bus_volume_db(sfx,linear_to_db(maxf(values.sfx,.0001)))
	AudioServer.set_bus_mute(sfx,values.sfx <= 0)
	game.player.sensitivity = values.sensitivity
	game.player.camera.fov = values.fov

func show_menu():
	if panel != null: panel.popup_centered(); return
	game.player.settings_input_blocked = true
	game.player.velocity = Vector3.ZERO
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	binding_draft = game.bindings.bindings.duplicate(true)
	binding_buttons.clear()
	panel = Window.new()
	panel.title = "환경 설정"
	panel.size = Vector2i(690,630)
	panel.transient = true
	panel.exclusive = true
	panel.theme = game.ui.root.theme
	panel.close_requested.connect(close_menu)
	panel.window_input.connect(window_input)
	panel.focus_exited.connect(func(): cancel_capture())
	panel.tree_exiting.connect(func(): game.player.settings_input_blocked = false)
	game.ui.root.add_child(panel)
	var margin = MarginContainer.new()
	margin.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left","right","top","bottom"]: margin.add_theme_constant_override("margin_"+side,24)
	panel.add_child(margin)
	var scroll = ScrollContainer.new()
	margin.add_child(scroll)
	var body = VBoxContainer.new()
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation",14)
	scroll.add_child(body)
	key_controls(body)
	game.ui.label(body,"디스플레이 / 소리 / 조작",25)
	var resolution = OptionButton.new()
	for text in ["1600 × 900","1280 × 720","1920 × 1080"]: resolution.add_item(text)
	resolution.selected = values.resolution
	body.add_child(resolution)
	var fullscreen = CheckBox.new()
	fullscreen.text = "전체 화면"
	fullscreen.button_pressed = values.fullscreen
	body.add_child(fullscreen)
	var vsync = CheckBox.new()
	vsync.text = "VSync · 화면 찢어짐 방지"
	vsync.button_pressed = values.vsync
	body.add_child(vsync)
	var quality = OptionButton.new()
	for text in ["Low · 80% / 기본 그림자","Medium · 원래 해상도 / AO / 2× MSAA","High · 4× MSAA / 약한 화면 발광","Ultra · 8× MSAA"]: quality.add_item(text)
	quality.selected = values.quality
	body.add_child(quality)
	var master = slider(body,"전체 소리 · 0은 음소거",values.master,0,1,.05)
	var sfx = slider(body,"환경음 / 효과음",values.sfx,0,1,.05)
	var sensitivity = slider(body,"마우스 감도",values.sensitivity,.0005,.004,.0001)
	var fov = slider(body,"시야각",values.fov,60,90,1)
	apply_button = game.ui.button(body,"적용하고 저장",func():
		var result = game.bindings.save_profile(binding_draft)
		if not result.ok: binding_status.text = result.message; return
		values = {"resolution":resolution.selected,"fullscreen":fullscreen.button_pressed,"vsync":vsync.button_pressed,"quality":quality.selected,"master":master.value,"sfx":sfx.value,"sensitivity":sensitivity.value,"fov":fov.value}
		apply()
		var file = FileAccess.open(path,FileAccess.WRITE)
		if file == null: binding_status.text = "조작키는 저장했습니다. 화면·소리 설정은 저장하지 못했습니다."; return
		file.store_string(JSON.stringify(values,"\t")); file.close()
		close_menu())
	panel.popup_centered()

func key_controls(body: VBoxContainer):
	game.ui.label(body,"조작키",24)
	game.ui.wrapped_label(body,"변경 버튼을 누른 뒤 새 키 하나를 누르세요. 해당 액션의 기존 키를 교체합니다. Esc도 할당할 수 있으며 입력 대기는 아래 취소 버튼으로 끝냅니다. 변경 후 ‘적용하고 저장’을 누르세요.",16,600)
	for action in LabInputBindings.ACTIONS:
		var row = HBoxContainer.new()
		row.add_theme_constant_override("separation",16)
		body.add_child(row)
		var label = game.ui.label(row,action.label,18)
		label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var button = game.ui.button(row,LabInputBindings.names(binding_draft[action.id]),func(): begin_capture(action.id))
		button.custom_minimum_size.x = 230
		binding_buttons[action.id] = button
	binding_status = game.ui.wrapped_label(body,game.bindings.load_status,16,600)
	binding_status.custom_minimum_size.y = 42
	binding_cancel = game.ui.button(body,"입력 대기 취소",cancel_capture)
	binding_cancel.disabled = true
	binding_reset = game.ui.button(body,"조작키 기본값으로 복원",func():
		cancel_capture()
		binding_draft = LabInputBindings.defaults()
		refresh_bindings()
		binding_status.text = "기본 키로 복원했습니다. 적용하고 저장을 눌러 확정하세요.")

func refresh_bindings():
	for id in binding_buttons:
		binding_buttons[id].text = "새 키를 누르세요…" if id == capture_action else LabInputBindings.names(binding_draft[id])
		binding_buttons[id].disabled = not capture_action.is_empty()
	if binding_cancel != null: binding_cancel.disabled = capture_action.is_empty()
	if binding_reset != null: binding_reset.disabled = not capture_action.is_empty()
	if apply_button != null: apply_button.disabled = not capture_action.is_empty()

func begin_capture(action: String):
	if not binding_draft.has(action): return
	capture_action = action
	capture_release_key = 0
	var focused = panel.gui_get_focus_owner()
	if focused != null: focused.release_focus()
	binding_status.text = LabInputBindings.label_for(action)+" · 새 키를 누르세요. Esc는 취소가 아니라 할당할 키입니다."
	refresh_bindings()

func cancel_capture():
	capture_action = ""
	if is_instance_valid(binding_status): binding_status.text = "입력 대기를 취소했습니다. 변경 사항은 아직 적용되지 않았습니다."
	refresh_bindings()

func window_input(event: InputEvent):
	if not event is InputEventKey: return
	if capture_release_key != 0 and event.physical_keycode == capture_release_key:
		panel.set_input_as_handled()
		if not event.pressed: capture_release_key = 0
		return
	if not capture_action.is_empty():
		panel.set_input_as_handled()
		if not event.pressed or event.echo: return
		var key = event.physical_keycode
		if (event.ctrl_pressed and key != KEY_CTRL) or (event.shift_pressed and key != KEY_SHIFT) or (event.alt_pressed and key != KEY_ALT) or event.meta_pressed:
			binding_status.text = "키 조합은 지원하지 않습니다. 다른 키를 놓고 키 하나만 누르세요."
			return
		var result = game.bindings.replace_key(binding_draft,capture_action,key)
		if not result.ok: binding_status.text = result.message; return
		binding_draft = result.bindings
		binding_status.text = LabInputBindings.label_for(capture_action)+" → "+LabInputBindings.names([key])+" · 적용하고 저장을 눌러 확정하세요."
		capture_action = ""
		capture_release_key = key
		refresh_bindings()
		return
	# The settings window owns its UI escape shortcut. Gameplay pause is blocked
	# for the whole window lifetime; Escape capture takes precedence above.
	if event.pressed and not event.echo and event.physical_keycode == KEY_ESCAPE:
		panel.set_input_as_handled()
		close_menu()

func close_menu():
	if panel == null: return
	capture_action = ""
	capture_release_key = 0
	for action in LabInputBindings.ACTIONS: Input.action_release(action.id)
	panel.hide()
	panel.queue_free()
	panel = null
	game.player.settings_input_blocked = false
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED if game.player.enabled else Input.MOUSE_MODE_VISIBLE

func slider(body: Node, title: String, value: float, low: float, high: float, step: float) -> HSlider:
	game.ui.label(body,title,17)
	var control = HSlider.new()
	control.min_value = low
	control.max_value = high
	control.step = step
	control.value = value
	body.add_child(control)
	return control
