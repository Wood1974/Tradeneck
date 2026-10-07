package app.tradedeck.shield.securecapture

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.Activity.ScreenCaptureCallback
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.TextView
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * In-app CameraX capture. There is no photo picker, no ACTION_GET_CONTENT,
 * and no MediaStore insert. The JPEG bytes from ImageCapture are the bytes
 * that get hashed.
 */
object CameraCapture {
    data class Shot(
        val jpeg: ByteArray,
        val location: Location?,
        val mockApi: String?,
        val screenCaptured: Boolean,
    )

    class CaptureException(val code: String) : Exception(code)

    fun open(
        activity: Activity,
        facing: String,
        done: (Result<Shot>) -> Unit,
    ) {
        activity.runOnUiThread {
            if (ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                done(Result.failure(CaptureException("camera-denied")))
                return@runOnUiThread
            }
            val owner = activity as? LifecycleOwner
            if (owner == null) {
                done(Result.failure(CaptureException("camera-failed")))
                return@runOnUiThread
            }
            present(activity, owner, facing, done)
        }
    }

    @SuppressLint("MissingPermission")
    private fun present(
        activity: Activity,
        owner: LifecycleOwner,
        facing: String,
        done: (Result<Shot>) -> Unit,
    ) {
        val decor = activity.window.decorView as ViewGroup
        val root = FrameLayout(activity).apply { setBackgroundColor(Color.BLACK) }
        val preview = PreviewView(activity).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FILL_CENTER
        }
        val shutter = Button(activity).apply {
            text = "SEAL"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setBackgroundColor(Color.WHITE)
            setTextColor(Color.BLACK)
        }
        val cancel = Button(activity).apply {
            text = "CANCEL"
            setBackgroundColor(Color.TRANSPARENT)
            setTextColor(Color.WHITE)
        }
        val hint = TextView(activity).apply {
            text = "In-app camera. Gallery import is not available."
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }
        val dp = { value: Int ->
            TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), activity.resources.displayMetrics).toInt()
        }
        root.addView(preview, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(shutter, FrameLayout.LayoutParams(dp(160), dp(80)).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            bottomMargin = dp(48)
        })
        root.addView(cancel, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.TOP or Gravity.START
            topMargin = dp(24)
            leftMargin = dp(16)
        })
        root.addView(hint, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            gravity = Gravity.TOP
            topMargin = dp(28)
        })
        decor.addView(root, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        val finished = AtomicBoolean(false)
        val screenCaptured = AtomicBoolean(false)
        val screenCallback: ScreenCaptureCallback? = if (Build.VERSION.SDK_INT >= 34) {
            ScreenCaptureCallback { screenCaptured.set(true) }
        } else null
        var latest: Location? = null
        var mockApi: String? = null
        val executor = Executors.newSingleThreadExecutor()
        var provider: ProcessCameraProvider? = null
        var capture: ImageCapture? = null

        fun finish(result: Result<Shot>) {
            if (!finished.compareAndSet(false, true)) return
            activity.runOnUiThread {
                provider?.unbindAll()
                if (Build.VERSION.SDK_INT >= 34 && screenCallback != null) {
                    try {
                        activity.unregisterScreenCaptureCallback(screenCallback)
                    } catch (_: Exception) {
                    }
                }
                (root.parent as? ViewGroup)?.removeView(root)
                executor.shutdown()
                done(result)
            }
        }

        if (Build.VERSION.SDK_INT >= 34 && screenCallback != null) {
            activity.registerScreenCaptureCallback(activity.mainExecutor, screenCallback)
        }
        requestFix(activity) { location, api ->
            latest = location
            mockApi = api
        }

        val future = ProcessCameraProvider.getInstance(activity)
        future.addListener({
            try {
                val cameraProvider = future.get()
                provider = cameraProvider
                val selector = if (facing == "front") CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
                val previewUse = Preview.Builder().build().also { it.surfaceProvider = preview.surfaceProvider }
                val imageCapture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .setJpegQuality(95)
                    .build()
                capture = imageCapture
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(owner, selector, previewUse, imageCapture)
            } catch (err: Exception) {
                finish(Result.failure(CaptureException("camera-failed")))
            }
        }, ContextCompat.getMainExecutor(activity))

        cancel.setOnClickListener { finish(Result.failure(CaptureException("camera-cancelled"))) }
        shutter.setOnClickListener {
            val imageCapture = capture
            if (imageCapture == null) {
                finish(Result.failure(CaptureException("camera-failed")))
                return@setOnClickListener
            }
            shutter.isEnabled = false
            imageCapture.takePicture(executor, object : ImageCapture.OnImageCapturedCallback() {
                override fun onCaptureSuccess(image: ImageProxy) {
                    val bytes = try {
                        jpegBytes(image)
                    } finally {
                        image.close()
                    }
                    if (bytes.isEmpty()) finish(Result.failure(CaptureException("empty-bytes")))
                    else finish(Result.success(Shot(bytes, latest, mockApi, screenCaptured.get())))
                }

                override fun onError(exception: ImageCaptureException) {
                    finish(Result.failure(CaptureException("camera-failed")))
                }
            })
        }
    }

    private fun jpegBytes(image: ImageProxy): ByteArray {
        val buffer = image.planes[0].buffer
        val bytes = ByteArray(buffer.remaining())
        buffer.get(bytes)
        return bytes
    }

    @SuppressLint("MissingPermission")
    private fun requestFix(activity: Activity, onFix: (Location?, String?) -> Unit) {
        val fine = ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!fine && !coarse) {
            onFix(null, null)
            return
        }
        val manager = activity.getSystemService(LocationManager::class.java) ?: return
        val provider = when {
            fine && manager.isProviderEnabled(LocationManager.GPS_PROVIDER) -> LocationManager.GPS_PROVIDER
            manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER) -> LocationManager.NETWORK_PROVIDER
            else -> null
        }
        if (provider == null) {
            onFix(null, null)
            return
        }
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                manager.getCurrentLocation(provider, null, activity.mainExecutor) { location ->
                    onFix(location, mockApi(location))
                }
            } else {
                @Suppress("DEPRECATION")
                manager.requestSingleUpdate(provider, { location -> onFix(location, mockApi(location)) }, Looper.getMainLooper())
            }
        } catch (_: Exception) {
            onFix(null, null)
        }
    }

    private fun mockApi(location: Location?): String? {
        if (location == null) return null
        return if (Build.VERSION.SDK_INT >= 31) "isMock" else "isFromMockProvider"
    }

    fun isMock(location: Location): Boolean {
        return if (Build.VERSION.SDK_INT >= 31) location.isMock
        else {
            @Suppress("DEPRECATION")
            location.isFromMockProvider
        }
    }
}
