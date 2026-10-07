class_name LabDevice
extends Area3D

var device_id: String
var missions: LabMissions
var display_name: String
var zone: String
var placard: Label3D

func setup(id: String, manager: LabMissions, box: AABB):
	device_id = id
	missions = manager
	display_name = manager.definitions.devices[id].label
	zone = manager.definitions.devices[id].zone
	collision_layer = 2
	collision_mask = 0
	var collision = CollisionShape3D.new()
	var shape = BoxShape3D.new()
	shape.size = box.size
	collision.shape = shape
	collision.position = box.get_center()
	add_child(collision)
	placard = Label3D.new()
	placard.position = box.get_center() + Vector3(0,0,.061)
	placard.pixel_size = .00135
	placard.font_size = 30
	placard.font = load("res://assets/fonts/NotoSansKR.ttf")
	placard.modulate = Color(.72,.87,.88)
	placard.outline_modulate = Color(.025,.045,.06)
	placard.outline_size = 10
	add_child(placard)
	missions.state_changed.connect(update_placard)
	update_placard()

func update_placard():
	var status = missions.device_status(device_id)
	placard.text = LabInputBindings.hint(display_name + "\n" + ("다음 · " + status.action + "\n" if status.objective else "") + status.text)
	placard.modulate = LabUI.STATUS_COLORS[status.tone]
	placard.outline_size = 13 if status.objective else 10

func get_interaction_prompt() -> String:
	return display_name + "\nE · " + ("변경 결과 재확인" if missions.device_status(device_id).tone == "pending" else missions.device_task(device_id)) + " / F · " + missions.device_tool(device_id).label

func inspect():
	missions.inspect(device_id)

func open_tool() -> String:
	return missions.device_tool(device_id).tab
