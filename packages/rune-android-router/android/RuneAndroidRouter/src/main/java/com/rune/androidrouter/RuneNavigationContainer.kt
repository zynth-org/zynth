package com.rune.androidrouter

import android.os.Bundle
import android.util.Log
import android.view.View
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentManager
import androidx.fragment.app.FragmentTransaction
import com.rune.kit.core.RuneRootView
import org.json.JSONObject

/**
 * Minimal Android Router - Single screen container for iterating on basic navigation.
 * 
 * This is a deliberately simple implementation to avoid the complexity that causes
 * freezes and rendering issues. Once stable, it will be merged into the main router.
 */
class RuneNavigationContainer {
    private val TAG = "RuneAndroidRouter"
    
    companion object {
        private var currentFragmentManager: FragmentManager? = null
        
        @JvmStatic
        fun setFragmentManager(manager: FragmentManager) {
            currentFragmentManager = manager
            Log.d("RuneAndroidRouter", "FragmentManager set: $manager")
        }
        
        @JvmStatic
        fun getCurrentFragmentManager(): FragmentManager? {
            return currentFragmentManager
        }
    }
    
    /**
     * Initialize the router with a root view container
     */
    fun initialize(containerId: Int, fragmentManager: FragmentManager) {
        Log.d(TAG, "Initializing navigation container with ID: $containerId")
        currentFragmentManager = fragmentManager
    }
    
    /**
     * Push a new screen onto the stack
     */
    fun pushScreen(screenName: String, params: JSONObject? = null) {
        Log.e(TAG, "🔥🔥🔥 pushScreen() CALLED: screenName=$screenName, params=$params 🔥🔥🔥")
        
        val manager = currentFragmentManager ?: run {
            Log.e(TAG, "🔥 ERROR: FragmentManager not available!")
            return
        }
        
        Log.e(TAG, "🔥 FragmentManager available, creating fragment...")
        
        val fragment = RuneScreenFragment.newInstance(screenName, params)
        Log.e(TAG, "🔥 Fragment created: $fragment")
        
        Log.e(TAG, "🔥 Beginning fragment transaction...")
        // Add fragment with custom animation
        val transaction = manager.beginTransaction()
            .setCustomAnimations(
                android.R.anim.slide_in_left,  // enter
                android.R.anim.slide_out_right, // exit
                android.R.anim.slide_in_left,  // popEnter
                android.R.anim.slide_out_right  // popExit
            )
            .add(android.R.id.content, fragment, screenName)
            .addToBackStack(screenName)
        
        Log.e(TAG, "🔥 Committing transaction...")
        transaction.commit()
        Log.e(TAG, "🔥🔥🔥 Transaction committed! Fragment should appear now. 🔥🔥🔥")
    }
    
    /**
     * Pop the current screen from the stack
     */
    fun popScreen() {
        val manager = currentFragmentManager ?: run {
            Log.e(TAG, "FragmentManager not available")
            return
        }
        
        Log.d(TAG, "Popping screen")
        
        if (manager.backStackEntryCount > 0) {
            manager.popBackStack()
        }
    }
}

/**
 * Fragment that hosts a Rune screen
 */
class RuneScreenFragment : Fragment() {
    private var screenName: String? = null
    private var params: JSONObject? = null
    private var runeRootView: RuneRootView? = null
    
    companion object {
        private const val ARG_SCREEN_NAME = "screen_name"
        private const val ARG_PARAMS = "params"
        
        fun newInstance(screenName: String, params: JSONObject?): RuneScreenFragment {
            return RuneScreenFragment().apply {
                arguments = Bundle().apply {
                    putString(ARG_SCREEN_NAME, screenName)
                    params?.let { putString(ARG_PARAMS, it.toString()) }
                }
            }
        }
    }
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        screenName = arguments?.getString(ARG_SCREEN_NAME)
        arguments?.getString(ARG_PARAMS)?.let {
            params = JSONObject(it)
        }
        
        Log.e("RuneScreenFragment", "🔥🔥🔥 Fragment onCreate: screen=$screenName 🔥🔥🔥")
    }
    
    override fun onCreateView(
        inflater: android.view.LayoutInflater,
        container: android.view.ViewGroup?,
        savedInstanceState: Bundle?
    ): View? {
        Log.e("RuneScreenFragment", "🔥🔥🔥 onCreateView: screen=$screenName 🔥🔥🔥")
        
        // Create a colored view to prove the Fragment is visible
        val fragmentView = android.widget.FrameLayout(requireContext()).apply {
            layoutParams = android.view.ViewGroup.LayoutParams(
                android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                android.view.ViewGroup.LayoutParams.MATCH_PARENT
            )
            // Bright color to prove native navigation is working!
            setBackgroundColor(android.graphics.Color.parseColor("#FF6B35"))
            
            // Add a text view to show the screen name
            val textView = android.widget.TextView(requireContext()).apply {
                text = "🔥 NATIVE FRAGMENT 🔥\n\nScreen: $screenName\nParams: ${params?.toString() ?: "none"}"
                textSize = 24f
                setTextColor(android.graphics.Color.WHITE)
                gravity = android.view.Gravity.CENTER
                setPadding(40, 40, 40, 40)
            }
            addView(textView)
        }
        
        Log.e("RuneScreenFragment", "🔥 Created colored Fragment view to prove native navigation!")
        return fragmentView
    }
    
    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        Log.d("RuneScreenFragment", "View created for screen: $screenName")
        
        // Here we would initialize the Rune UI for this screen
        // For now, it's just a container that the JS side can populate
    }
    
    override fun onDestroyView() {
        super.onDestroyView()
        runeRootView = null
        Log.d("RuneScreenFragment", "View destroyed for screen: $screenName")
    }
    
    fun getRootView(): RuneRootView? = runeRootView
}
