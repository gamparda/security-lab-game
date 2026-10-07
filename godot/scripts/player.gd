class_name LabPlayer
extends CharacterBody3D

signal inspect_requested(target: Node)
signal tool_requested(target: Node)
signal pause_requested
var camera: Camera3D
var ray: RayCast3D
var shape: CollisionShape3D
var target: Node
var enabled = false
var settings_input_blocked = false
var crouched = false
var sensitivity = 0.0018
var body_height = 1.8
var movement_seconds = 0.0
var jump_peak = 0.0
var jump_count = 0
var standing_shape = CapsuleShape3D.new()

func _ready():
	collision_layer = 8
	collision_mask = 1
	floor_snap_length = 0.12
	standing_shape.radius = 0.305
	standing_shape.height = 1.8
	shape = CollisionShape3D.new()
	shape.shape = standing_shape.duplicate()
	shape.position.y = 0.9
	add_child(shape)
	camera = Camera3D.new()
	camera.position.y = 1.65
	camera.fov = 72
	camera.far = 1600
	add_child(camera)
	ray = RayCast3D.new()
	ray.target_position = Vector3(0, 0, -2.65)
	ray.collision_mask = 6
	ray.collide_with_areas = true
	ray.add_exception(self)
	camera.add_child(ray)

func set_enabled(value: bool):
	enabled = value
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED if value else Input.MOUSE_MODE_VISIBLE
	if not value: velocity = Vector3.ZERO

func _unhandled_input(event):
	if settings_input_blocked: return
	if event.is_action_pressed("pause"):
		pause_requested.emit()
		get_viewport().set_input_as_handled()
	if not enabled or settings_input_blocked: return
	if event is InputEventMouseMotion:
		rotate_y(-event.relative.x * sensitivity)
		camera.rotation.x = clampf(camera.rotation.x - event.relative.y * sensitivity, -1.42, 1.42)
	if event.is_action_pressed("inspect") and target != null: inspect_requested.emit(target)
	if event.is_action_pressed("tool") and target != null and target.has_method("open_tool"): tool_requested.emit(target)

func _physics_process(delta):
	ray.force_raycast_update()
	target = ray.get_collider() if ray.is_colliding() else null
	if target != null and not target.has_method("get_interaction_prompt"): target = null
	if not enabled or settings_input_blocked: velocity = Vector3.ZERO; return
	var wants_crouch = Input.is_action_pressed("crouch")
	if crouched and not wants_crouch:
		var query = PhysicsShapeQueryParameters3D.new()
		query.shape = standing_shape
		query.transform = Transform3D(Basis.IDENTITY, global_position + Vector3(0, 0.91, 0))
		query.collision_mask = 1
		query.exclude = [get_rid()]
		wants_crouch = not get_world_3d().direct_space_state.intersect_shape(query, 1).is_empty()
	crouched = wants_crouch
	body_height = 1.1 if crouched else 1.8
	shape.shape.height = body_height
	shape.position.y = body_height / 2.0
	camera.position.y = lerpf(camera.position.y, 0.95 if crouched else 1.65, 1.0 - exp(-delta * 18.0))
	var axes = Input.get_vector("left", "right", "forward", "back")
	var direction = global_basis * Vector3(axes.x, 0, axes.y)
	var speed = 1.35 if crouched else 4.2 if Input.is_action_pressed("sprint") else 2.6
	velocity.x = direction.x * speed
	velocity.z = direction.z * speed
	if axes.length() > 0: movement_seconds += delta
	if is_on_floor() and Input.is_action_just_pressed("jump"):
		velocity.y = 4.3
		jump_count += 1
	elif not is_on_floor(): velocity.y -= 12.5 * delta
	else: velocity.y = 0
	move_and_slide()
	jump_peak = maxf(jump_peak, global_position.y)
	if global_position.y < -3: respawn()

func respawn():
	global_position = Vector3(0, 0.01, 11.7)
	rotation = Vector3.ZERO
	camera.rotation = Vector3.ZERO
	velocity = Vector3.ZERO
