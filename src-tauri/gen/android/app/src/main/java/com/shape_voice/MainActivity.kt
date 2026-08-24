package com.shape_voice

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.widget.Button
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

class MainActivity : ComponentActivity() {
  private var settingsLaunchInProgress = false
  private var tauriActivityLaunched = false

  private val manageAllFilesLauncher = registerForActivityResult(
    ActivityResultContracts.StartActivityForResult(),
  ) {
    settingsLaunchInProgress = false
    launchTauriActivityIfAllowed()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    if (launchTauriActivityIfAllowed()) {
      return
    }

    setContentView(R.layout.activity_storage_permission)
    findViewById<Button>(R.id.open_storage_settings).setOnClickListener {
      openManageAllFilesSettings()
    }

    if (savedInstanceState == null) {
      openManageAllFilesSettings()
    }
  }

  override fun onResume() {
    super.onResume()
    launchTauriActivityIfAllowed()
  }

  private fun hasRequiredStorageAccess(): Boolean {
    return Build.VERSION.SDK_INT < Build.VERSION_CODES.R ||
      Environment.isExternalStorageManager()
  }

  private fun launchTauriActivityIfAllowed(): Boolean {
    if (!hasRequiredStorageAccess() || tauriActivityLaunched) {
      return false
    }

    tauriActivityLaunched = true
    startActivity(Intent(this, TauriMainActivity::class.java))
    finish()
    return true
  }

  private fun openManageAllFilesSettings() {
    if (
      Build.VERSION.SDK_INT < Build.VERSION_CODES.R ||
      Environment.isExternalStorageManager() ||
      settingsLaunchInProgress
    ) {
      launchTauriActivityIfAllowed()
      return
    }

    settingsLaunchInProgress = true

    val appIntent = Intent(
      Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
      Uri.parse("package:$packageName"),
    )

    try {
      manageAllFilesLauncher.launch(appIntent)
    } catch (_: Exception) {
      try {
        manageAllFilesLauncher.launch(
          Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION),
        )
      } catch (_: Exception) {
        settingsLaunchInProgress = false
      }
    }
  }
}
