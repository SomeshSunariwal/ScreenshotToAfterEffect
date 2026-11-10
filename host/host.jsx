var Screenshot2AE = (function () {
    function saveFrame(comp, file) {
        if (typeof comp.saveFrameToPng !== "function") {
            throw new Error("This version of After Effects cannot render the image preview.");
        }
        comp.saveFrameToPng(comp.time, new File(file));
    }

    function stillImageFile(item) {
        if (!(item instanceof FootageItem) || !item.hasVideo || !item.mainSource.isStill) {
            throw new Error("Select a still image layer in the composition timeline.");
        }
        var file = item.file;
        if (item.footageMissing || (file && !file.exists)) {
            throw new Error("Relink the selected image in After Effects and try again.");
        }
        if (!file) throw new Error("Select an imported image layer in the composition timeline.");
        return file;
    }

    function selectedImage() {
        var comp = app.project && app.project.activeItem;
        if (!(comp instanceof CompItem) || comp.selectedLayers.length !== 1) {
            throw new Error("Select one image layer in the active composition timeline.");
        }
        var layer = comp.selectedLayers[0];
        var item = layer.source;
        var file = stillImageFile(item);
        return item.id + "\n" + encodeURIComponent(file.fsName) + "\n" + encodeURIComponent(layer.name);
    }

    function renderStill(item, outputPath) {
        var comp = app.project.items.addComp("Screenshot2AE decode", Math.max(4, item.width), Math.max(4, item.height), 1, 1, 24);
        try {
            var layer = comp.layers.add(item);
            layer.property("ADBE Transform Group").property("ADBE Position").setValue([item.width / 2, item.height / 2]);
            saveFrame(comp, outputPath);
        } finally {
            comp.remove();
        }
    }

    function renderSelectedImage(id, sourcePath, outputPath) {
        var item = app.project && app.project.itemByID(id);
        if (stillImageFile(item).fsName !== sourcePath) {
            throw new Error("The selected image source changed. Select the layer and try again.");
        }
        renderStill(item, outputPath);
    }

    function decode(sourcePath, outputPath) {
        var item;
        app.beginSuppressDialogs();
        try {
            if (!app.project) app.newProject();
            var options = new ImportOptions(new File(sourcePath));
            if (options.canImportAs(ImportAsType.FOOTAGE)) options.importAs = ImportAsType.FOOTAGE;
            options.sequence = false;
            item = app.project.importFile(options);
            if (!(item instanceof FootageItem) || !item.hasVideo) throw new Error("After Effects could not import the image as footage.");
            renderStill(item, outputPath);
        } finally {
            try {
                if (item) item.remove();
            } finally {
                app.endSuppressDialogs(false);
            }
        }
    }

    // Adapted from Denys Bondartsov's damped oscillation at Motion Design School.
    // The incoming speed at the second key drives the one-second settle.
    var motionExpression = [
        "function settleMotion() {",
        "    if (thisProperty.numKeys < 2) return value;",
        "    var reached = thisProperty.nearestKey(time).index;",
        "    if (thisProperty.key(reached).time > time) reached--;",
        "    if (reached < 2) return value;",
        "    var start = thisProperty.key(reached - 1);",
        "    var arrival = thisProperty.key(reached);",
        "    var elapsed = time - arrival.time;",
        "    if (elapsed <= 0 || elapsed >= 1) return value;",
        "    var rig = thisComp.layer('Controller');",
        "    var mode = rig.effect('Motion')(1).value;",
        "    if (mode === 1) return value;",
        "    var amplitude = Math.max(0, rig.effect('Amplitude')(1).value);",
        "    var frequency = Math.max(0, rig.effect('Frequency')(1).value);",
        "    var decay = Math.max(0, rig.effect('Decay')(1).value);",
        "    var wave = Math.sin(frequency * elapsed * 2 * Math.PI);",
        "    if (mode === 3) wave = -Math.abs(wave);",
        "    var weight = amplitude * wave / Math.exp(decay * elapsed);",
        "    var travelTime = arrival.time - start.time;",
        "    var probe = Math.min(thisComp.frameDuration / 10, travelTime / 2);",
        "    var incomingVelocity = thisProperty.velocityAtTime(arrival.time - probe);",
        "    if (length(incomingVelocity) < 0.001) {",
        "        incomingVelocity = div(sub(arrival.value, start.value), travelTime);",
        "    }",
        "    return add(value, mul(incomingVelocity, weight));",
        "}",
        "settleMotion();"
    ].join("\n");

    function addMotionController(comp, duration, effect) {
        var controller = comp.layers.addNull(duration);
        controller.name = "Controller";
        controller.moveToBeginning();

        var menuEffect = controller.property("ADBE Effect Parade").addProperty("ADBE Dropdown Control");
        var menuIndex = menuEffect.propertyIndex;
        var menu = menuEffect.property(1).setPropertyParameters(["None", "Elastic", "Bounce"]);
        menu.setValue(effect === "elastic" ? 2 : effect === "bounce" ? 3 : 1);
        controller.property("ADBE Effect Parade").property(menuIndex).name = "Motion";

        function addSlider(name, value) {
            var control = controller.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
            control.name = name;
            control.property(1).setValue(value);
        }

        addSlider("Amplitude", 0.05);
        addSlider("Frequency", effect === "elastic" ? 1 : 0.5);
        addSlider("Decay", 2);
    }

    function buildMotion(settings, width, height, fps) {
        var directions = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] };
        var style = settings.style;
        var pop = style === "pop";
        var fade = typeof style === "string" && style.indexOf("fade-") === 0;
        var directionName = fade ? style.substring(5) : style;
        if ((!pop && !directions.hasOwnProperty(directionName))
            || (settings.effect !== "none" && settings.effect !== "elastic" && settings.effect !== "bounce")) {
            throw new Error("Choose a valid animation style and effect.");
        }
        var direction = pop ? [0, 0] : directions[directionName];
        var duration = settings.duration;
        var stagger = settings.stagger;
        if (typeof duration !== "number" || typeof stagger !== "number"
            || !isFinite(duration) || !isFinite(stagger) || duration < 0 || stagger < 0) {
            throw new Error("Enter a duration and stagger of 0 seconds or more.");
        }
        var frames = duration === 0 ? 0 : Math.max(1, Math.round(duration * fps));
        var axisSize = direction[0] ? width : height;
        var distance = fade ? Math.max(6, Math.min(32, Math.round(axisSize * 0.035)))
            : Math.max(12, Math.min(120, Math.round(axisSize * 0.08)));
        return { frames: frames, staggerFrames: stagger * fps, pop: pop, x: direction[0] * distance, y: direction[1] * distance };
    }

    function applyMotion(layer, motion, index, fps) {
        var start = Math.round(index * motion.staggerFrames);
        layer.inPoint = start / fps;
        if (motion.frames === 0) return;
        var transform = layer.property("ADBE Transform Group");
        var movement = transform.property(motion.pop ? "ADBE Scale" : "ADBE Position");
        var rest = movement.value;
        var entrance = motion.pop ? [rest[0] * 0.7, rest[1] * 0.7] : [rest[0] + motion.x, rest[1] + motion.y];
        var end = (start + motion.frames) / fps;
        var times = [start / fps, end];
        movement.setValuesAtTimes(times, [entrance, rest]);
        var linear = KeyframeInterpolationType.LINEAR;
        var bezier = KeyframeInterpolationType.BEZIER;
        var easeOut = new KeyframeEase(0, 33.33);
        var ease = motion.pop ? [easeOut, easeOut] : [easeOut];
        movement.setInterpolationTypeAtKey(1, linear, bezier);
        movement.setTemporalEaseAtKey(1, ease, ease);
        movement.setInterpolationTypeAtKey(2, linear, linear);
        movement.expression = motionExpression;
        if (movement.expressionError) throw new Error(movement.expressionError);
        var opacity = transform.property("ADBE Opacity");
        opacity.setValuesAtTimes(times, [0, 100]);
        opacity.setInterpolationTypeAtKey(1, linear, linear);
        opacity.setInterpolationTypeAtKey(2, linear, linear);
    }

    function create(job) {
        var folder, comp;
        var footage = [];
        app.beginUndoGroup("Screenshot2AE Create Layers");
        try {
            if (!app.project) app.newProject();
            var name = job.name + " - Layers";
            var fps = 30;
            var motion = job.animation ? buildMotion(job.animation, job.width, job.height, fps) : null;
            var lastFrame = motion ? Math.round((job.boxes.length - 1) * motion.staggerFrames) + motion.frames : 0;
            var maxDuration = 10800;
            if (!(lastFrame < maxDuration * fps)) {
                throw new Error("Shorten Duration or Stagger to fit the After Effects composition.");
            }
            var duration = Math.min(maxDuration, Math.max(5, 1 + lastFrame / fps));
            comp = app.project.items.addComp(name, Math.max(4, job.width), Math.max(4, job.height), 1, duration, fps);
            folder = app.project.items.addFolder(name + " Assets");

            function addLayer(path, name, x, y) {
                var file = new File(path);
                if (!file.exists) throw new Error("An exported PNG is missing: " + file.name);
                var options = new ImportOptions(file);
                options.sequence = false;
                var item = app.project.importFile(options);
                footage.push(item);
                item.parentFolder = folder;
                var layer = comp.layers.add(item, duration);
                layer.name = name;
                var transform = layer.property("ADBE Transform Group");
                transform.property("ADBE Position").setValue([x + item.width / 2, y + item.height / 2]);
                return layer;
            }

            addLayer(job.background, "Background", 0, 0);
            var boxLayers = [];
            for (var i = job.boxes.length - 1; i >= 0; i--) {
                var box = job.boxes[i];
                var number = (i + 1 < 10 ? "0" : "") + (i + 1);
                boxLayers[i] = addLayer(box.path, "Box " + number, box.x, box.y);
            }
            if (motion) {
                addMotionController(comp, duration, job.animation.effect);
                for (var i = 0; i < boxLayers.length; i++) {
                    applyMotion(boxLayers[i], motion, i, fps);
                }
            }
        } catch (error) {
            if (comp) comp.remove();
            for (var j = footage.length - 1; j >= 0; j--) footage[j].remove();
            if (folder) folder.remove();
            throw error;
        } finally {
            app.endUndoGroup();
        }
        try { comp.openInViewer(); } catch (ignored) {}
        return comp.name;
    }

    return {
        run: function (action, args) {
            try {
                if (action === "selectedImage") return "ok\n" + selectedImage();
                if (action === "renderSelectedImage") { renderSelectedImage(args[0], args[1], args[2]); return "ok\n"; }
                if (action === "decode") { decode(args[0], args[1]); return "ok\n"; }
                if (action === "create") return "ok\n" + create(args[0]);
                throw new Error("Unknown Screenshot2AE action.");
            } catch (error) {
                return "error\n" + error.message;
            }
        }
    };
}());
