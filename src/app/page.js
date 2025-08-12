"use client";

import { useState, useRef, useEffect } from "react";
import styles from "./page.module.css";

export default function HomePage() {
  const [task, setTask] = useState("");
  const [goal, setGoal] = useState("");
  const [taskId, setTaskId] = useState("");
  const [steps, setSteps] = useState([]);
  const [currentStep, setCurrentStep] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [history, setHistory] = useState([]);
  const [image, setImage] = useState(null);
  const [textNote, setTextNote] = useState("");
  const [message, setMessage] = useState("");
  const [options, setOptions] = useState([]); // options returned by AI
  const [loading, setLoading] = useState(false);

  // Camera states
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [capturedImage, setCapturedImage] = useState(null);
  const [useCamera, setUseCamera] = useState(false);
  const [cameraError, setCameraError] = useState("");

  // Refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const apiRoot = process.env.API_ROOT || "http://localhost:5000";

  // Start camera
  const startCamera = async () => {
    try {
      setCameraError("");
      
      // Check if mediaDevices is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera API is not supported in your browser");
      }
      
      // Try different constraints for better compatibility
      const constraints = {
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setCameraStream(stream);
      setCameraActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      let errorMessage = "Could not access camera. Please check permissions.";
      
      if (err.name === "NotAllowedError") {
        errorMessage = "Camera access denied. Please allow camera permissions.";
      } else if (err.name === "NotFoundError" || err.name === "OverconstrainedError") {
        errorMessage = "No camera found or camera not compatible.";
      } else if (err.name === "NotReadableError") {
        errorMessage = "Camera is being used by another application.";
      } else if (err.name === "AbortError") {
        errorMessage = "Camera access was aborted.";
      }
      
      setCameraError(errorMessage);
      setUseCamera(false);
    }
  };

  // Stop camera
  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
    setCameraActive(false);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // Capture image from camera
  const captureImage = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      // Set canvas dimensions to match video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext("2d");
      
      // Draw video frame to canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Convert to blob with optimized quality
      canvas.toBlob((blob) => {
        if (blob) {
          // Create a more descriptive filename
          const timestamp = new Date().getTime();
          const file = new File([blob], `captured-image-${timestamp}.jpg`, { type: "image/jpeg" });
          setCapturedImage(file);
          setImage(file); // Set image for verification
        }
      }, "image/jpeg", 0.8); // 80% quality for balance of size and quality
    }
  };

  // Clean up camera on unmount
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [cameraStream]);

  async function startTask(e) {
    e.preventDefault();
    if (!task.trim()) return;
    setLoading(true);
    setMessage("");
    setTaskId(""); // Reset task ID for new task
    try {
      const res = await fetch(`${apiRoot}/start-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start");
      setTaskId(data.taskId || "");
      setGoal(data.goal || task);
      setSteps(data.steps || []);
      setCurrentIndex(0);
      setCurrentStep(data.currentStep || (data.steps && data.steps[0]) || "");
      setHistory([]);
      setMessage("Task started. Follow the steps.");
      setOptions([]);
    } catch (err) {
      console.error(err);
      setMessage("Error starting task");
    } finally {
      setLoading(false);
    }
  }

  async function verifyStep() {
    // require at least one proof (image or text)
    if (!image && !textNote.trim()) {
      setMessage("Please provide an image or a text note.");
      return;
    }
    setLoading(true);
    setMessage("");
    setOptions([]);
    try {
      const form = new FormData();
      form.append("taskId", taskId);
      if (image) form.append("image", image);
      if (textNote.trim()) form.append("textNote", textNote.trim());

      const res = await fetch(`${apiRoot}/verify-step`, {
        method: "POST",
        body: form,
      });

      const data = await res.json();
      if (!res.ok && !data) throw new Error("Verification failed");

      // handle responses
      if (data.done) {
        setMessage(data.message || "All steps completed!");
        setHistory(data.history || history);
        setSteps([]);
        setCurrentStep("");
        setCurrentIndex(0);
        setOptions([]);
      } else {
        // append history entry locally for display (backend already saved)
        setHistory((h) => [
          ...h,
          {
            step: currentStep,
            evidence: { text: textNote || null, image: image ? true : false },
            result: { passed: data.passed, reason: data.reason },
            ts: new Date().toISOString(),
          },
        ]);

        if (data.passed) {
          // if AI returned updated nextSteps, use them
          if (Array.isArray(data.nextSteps)) {
            setSteps(data.nextSteps);
            setCurrentIndex(0);
            setCurrentStep(data.nextSteps[0] || "");
          } else if (data.nextStep) {
            // backend advanced index and returned nextStep
            // find index in current local steps (best-effort)
            const nextIndex = steps.indexOf(data.nextStep);
            if (nextIndex >= 0) {
              setCurrentIndex(nextIndex);
              setCurrentStep(data.nextStep);
            } else {
              // fallback: set to provided nextStep and append if needed
              setSteps((s) => {
                if (!s.includes(data.nextStep)) return [...s, data.nextStep];
                return s;
              });
              setCurrentStep(data.nextStep || "");
            }
          } else {
            // no nextStep provided, simple increment local index
            const ni = currentIndex + 1;
            setCurrentIndex(ni);
            setCurrentStep(steps[ni] || "");
          }
          setMessage(`✅ ${data.reason || "Step passed"}`);
        } else {
          // not passed: keep same currentStep but show reason and options
          setMessage(`❌ ${data.reason || "Step not satisfied"}`);
          if (Array.isArray(data.nextSteps)) {
            setSteps(data.nextSteps);
            setCurrentIndex(0);
            setCurrentStep(data.nextSteps[0] || "");
          }
          setOptions(Array.isArray(data.options) ? data.options : []);
        }
      }

      // clear proofs on success or keep if not passed
      if (data.passed) {
        setImage(null);
        setTextNote("");
      }
    } catch (err) {
      console.error(err);
      setMessage("Error verifying step");
    } finally {
      setLoading(false);
    }
  }

  async function doneStep() {
    setLoading(true);
    setMessage("");
    setOptions([]);
    try {
      const res = await fetch(`${apiRoot}/mark-step-done`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: taskId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to mark step as done");

      // handle responses
      if (data.done) {
        setMessage(data.message || "All steps completed!");
        setHistory(data.history || history);
        setSteps([]);
        setCurrentStep("");
        setCurrentIndex(0);
        setOptions([]);
      } else {
        // append history entry locally for display (backend already saved)
        setHistory((h) => [
          ...h,
          {
            step: currentStep,
            evidence: { text: "Step marked as done without verification", image: false },
            result: { passed: true, reason: "Step marked as done" },
            ts: new Date().toISOString(),
          },
        ]);

        // Move to next step
        const ni = currentIndex + 1;
        setCurrentIndex(ni);
        setCurrentStep(steps[ni] || "");
        setMessage(`✅ Step marked as done`);
      }

      // clear proofs
      setImage(null);
      setTextNote("");
    } catch (err) {
      console.error(err);
      setMessage("Error marking step as done");
    } finally {
      setLoading(false);
    }
  }

  async function applyOption(opt) {
    // Some options may be 'restart' or 'quit'. Send to backend.
    if (!opt) return;
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(`${apiRoot}/apply-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: opt, taskId: taskId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");

      if (opt === "quit") {
        setMessage(data.message || "Task quit");
        setGoal("");
        setTaskId("");
        setSteps([]);
        setCurrentStep("");
        setCurrentIndex(0);
        setHistory([]);
        setOptions([]);
      } else if (opt === "restart") {
        setSteps(data.steps || []);
        setCurrentStep(data.currentStep || (data.steps && data.steps[0]) || "");
        setCurrentIndex(0);
        setHistory([]);
        setMessage("Task restarted with new plan");
        setOptions([]);
      } else {
        setMessage(data.message || `Action applied: ${opt}`);
      }
    } catch (err) {
      console.error(err);
      setMessage("Error applying action");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.container}>
      <h1 className={styles.title}>AI Fella</h1>

      {!goal && (
        <form onSubmit={startTask} className={styles.form}>
          <label className={styles.label}>What do you want to do?</label>
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="e.g. I want to make tea"
            className={styles.input}
          />
          <div className={styles.actions}>
            <button className={styles.button} disabled={loading}>
              {loading ? "Thinking..." : "Start Task"}
            </button>
          </div>
        </form>
      )}

      {goal && (
        <section className={styles.workflow}>
          <div className={styles.meta}>
            <strong>Goal:</strong> {goal}
          </div>

          <div className={styles.stepsBox}>
            <h3>Steps</h3>
            <ol>
              {steps.map((s, idx) => (
                <li
                  key={idx}
                  style={{
                    fontWeight: idx === currentIndex ? 700 : 400,
                    opacity: idx < currentIndex ? 0.6 : 1,
                    marginBottom: 6,
                  }}
                >
                  {s}
                </li>
              ))}
            </ol>
          </div>

          {currentStep && (
            <div className={styles.current}>
              <h3>Current step</h3>
              <p className={styles.stepText}>{currentStep}</p>

              <div className={styles.inputMethodToggle}>
                <button
                  className={`${styles.toggleButton} ${!useCamera ? styles.active : ""}`}
                  onClick={() => {
                    setUseCamera(false);
                    if (cameraActive) stopCamera();
                    setCapturedImage(null);
                  }}
                >
                  Upload Image
                </button>
                <button
                  className={`${styles.toggleButton} ${useCamera ? styles.active : ""}`}
                  onClick={() => {
                    setUseCamera(true);
                    if (!cameraActive) startCamera();
                    setImage(null);
                  }}
                >
                  Use Camera
                </button>
              </div>

              {!useCamera ? (
                <>
                  <input
                    type="text"
                    placeholder="Short text proof (optional)"
                    value={textNote}
                    onChange={(e) => setTextNote(e.target.value)}
                    className={styles.input}
                  />

                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setImage(e.target.files[0])}
                    className={styles.fileInput}
                  />
                </>
              ) : (
                <div className={styles.cameraSection}>
                  {cameraError && (
                    <div className={styles.cameraError}>{cameraError}</div>
                  )}

                  {!cameraActive ? (
                    <div className={styles.cameraPlaceholder}>
                      <p>Camera is not active</p>
                      <button
                        onClick={startCamera}
                        className={styles.button}
                        disabled={loading}
                      >
                        Start Camera
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className={styles.cameraContainer}>
                        <video
                          ref={videoRef}
                          autoPlay
                          playsInline
                          muted
                          className={styles.cameraVideo}
                        />
                        <div className={styles.instructionOverlay}>
                          <p>{currentStep}</p>
                        </div>
                        <canvas ref={canvasRef} style={{ display: "none" }} />
                      </div>

                      {!capturedImage ? (
                        <button
                          onClick={captureImage}
                          className={styles.captureButton}
                          disabled={loading}
                        >
                          Capture Image
                        </button>
                      ) : (
                        <div className={styles.capturedImagePreview}>
                          <p>Image captured!</p>
                          <button
                            onClick={() => {
                              setCapturedImage(null);
                              setImage(null);
                            }}
                            className={styles.button}
                          >
                            Retake
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <button
                  onClick={verifyStep}
                  disabled={loading}
                  className={styles.button}
                >
                  {loading ? "Checking..." : "Verify"}
                </button>
                
                <button
                  onClick={doneStep}
                  disabled={loading}
                  className={styles.button}
                  style={{ backgroundColor: "#4CAF50" }}
                >
                  {loading ? "Processing..." : "Done"}
                </button>

                <button
                  onClick={() => applyOption("restart")}
                  disabled={loading}
                  className={styles.ghost}
                >
                  Restart
                </button>

                <button
                  onClick={() => applyOption("quit")}
                  disabled={loading}
                  className={styles.ghost}
                >
                  Quit
                </button>
              </div>
            </div>
          )}

          {options && options.length > 0 && (
            <div className={styles.options}>
              <h4>AI suggests:</h4>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {options.map((o, i) => (
                  <button
                    key={i}
                    onClick={() => applyOption(o)}
                    className={styles.optionBtn}
                    disabled={loading}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>
          )}

          {message && (
            <div className={styles.result}>
              <p>{message}</p>
            </div>
          )}

          {history.length > 0 && (
            <div className={styles.history}>
              <h4>History (latest first)</h4>
              <ul>
                {history
                  .slice()
                  .reverse()
                  .map((h, i) => (
                    <li key={i}>
                      <small>
                        <strong>{h.step}</strong> — {h.result.passed ? "✅" : "❌"}{" "}
                        {h.result.reason}
                      </small>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
