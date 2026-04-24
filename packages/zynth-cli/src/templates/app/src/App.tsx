import {
  View,
  Text,
  Pressable,
  Image,
  LayoutChangeEvent,
} from "@zynthjs/components";
import {
  createEntryExitAnimation,
  LinearTransition,
} from "@zynthjs/core/motion";
import { createSignal, For } from "solid-js";
import logo from "./assets/zynth-logo.png";

const enterAnimation = createEntryExitAnimation({
  from: { transform: [{ translateX: 100 }], opacity: 0 },
  to: { transform: [{ translateX: 0 }], opacity: 1 },
  duration: 400,
  easing: "easeOutCubic",
});

const exitAnimation = createEntryExitAnimation({
  from: { transform: [{ translateX: 0 }], opacity: 1 },
  to: { transform: [{ translateX: -100 }], opacity: 0 },
  duration: 400,
  easing: "easeInOut",
});

const STEPS = [
  {
    title: "Welcome to Zynth",
    description:
      "Build native apps with fine-grained reactivity. SolidJS primitives for predictable, low-latency state",
  },
  {
    title: "Shared Signals",
    description:
      "Drive 60FPS interactions via shared native memory. Run reactive logic on UI thread without bridge latency.",
  },
  {
    title: "Multi-Platform",
    description:
      "Target iOS, Android, and Web. Unified native core for portable code across every platform",
  },
  {
    title: "Ready to Build?",
    description:
      "Modify App.tsx for instant updates. See UI changes in real-time as you iterate on your code",
  },
];

export default function WelcomeScreen() {
  const [activeStep, setActiveStep] = createSignal(0);
  const [isInitial, setIsInitial] = createSignal(true);
  const [contentHeight, setContentHeight] = createSignal(0);

  const onNext = () => {
    setIsInitial(false);
    setActiveStep((prev) => (prev === STEPS.length - 1 ? 0 : prev + 1));
  };

  const onLayout = (event: LayoutChangeEvent) => {
    setContentHeight(event.nativeEvent.layout.height);
  };

  return (
    <View
      style={{
        flex: 1,
        padding: 40,
        justifyContent: "space-between",
        background: "linear-gradient(to top, #050505 0%, #292929 100%)",
      }}
    >
      <View
        style={{
          flexDirection: "column",
          gap: 15,
          justifyContent: "center",
          alignItems: "center",
          flex: 1,
        }}
      >
        <View>
          <Image
            source={logo}
            style={{ width: 140, height: 140 }}
            resizeMode="contain"
          />
        </View>

        <View
          style={{
            height: contentHeight(),
            justifyContent: "center",
            alignItems: "center",
            width: "100%",
          }}
        >
          <For each={STEPS}>
            {(step, index) => (
              <View
                visible={activeStep() === index()}
                entering={isInitial() ? undefined : enterAnimation}
                exiting={exitAnimation}
                onLayout={onLayout}
                style={{
                  position: "absolute",
                  alignItems: "center",
                  width: "100%",
                }}
              >
                <Text
                  style={{
                    fontSize: 34,
                    fontWeight: "900",
                    color: "#ffffff",
                    textAlign: "center",
                    marginBottom: 16,
                    letterSpacing: -0.5,
                  }}
                >
                  {step.title}
                </Text>
                <Text
                  style={{
                    fontSize: 18,
                    color: "#94a3b8",
                    textAlign: "center",
                    lineHeight: 28,
                  }}
                >
                  {step.description}
                </Text>
              </View>
            )}
          </For>
        </View>
      </View>

      <View style={{ alignItems: "center", paddingBottom: 40, width: "100%" }}>
        <View style={{ flexDirection: "row", marginBottom: 48, height: 8 }}>
          <For each={STEPS}>
            {(_, index) => (
              <View
                layout={LinearTransition.duration(300)}
                style={{
                  width: 8,
                  height: 8,
                  paddingHorizontal: activeStep() === index() ? 8 : 0,
                  borderRadius: 4,
                  backgroundColor:
                    activeStep() === index() ? "#ffffff" : "#27272a",
                  marginHorizontal: 4,
                }}
              />
            )}
          </For>
        </View>

        <Pressable
          onPress={onNext}
          style={{
            backgroundColor: "#ffffff",
            paddingVertical: 20,
            width: "100%",
            borderRadius: 20,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: "#050505",
              fontSize: 20,
              fontWeight: "800",
              letterSpacing: 0.5,
            }}
          >
            {activeStep() === STEPS.length - 1 ? "Start again" : "Get Started"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
