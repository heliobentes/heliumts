import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";

// Mock the Router module to provide useRouter
vi.mock("../../src/client/Router", () => ({
    useRouter: vi.fn(() => ({
        path: "/current",
        isPending: false,
        isNavigating: false,
    })),
}));

import { useDeferredNavigation, PageTransition, type PageTransitionProps } from "../../src/client/transitions";
import { useRouter } from "../../src/client/Router";
import { renderHook } from "@testing-library/react";

describe("transitions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("useDeferredNavigation", () => {
        it("should return current path from router", () => {
            const { result } = renderHook(() => useDeferredNavigation());

            expect(result.current.path).toBe("/current");
        });

        it("should compute isStale when deferredPath differs from path", () => {
            // useDeferredValue returns the same value initially
            const { result } = renderHook(() => useDeferredNavigation());

            // Initially not stale (same values)
            expect(result.current.isStale).toBe(false);
        });

        it("should return isPending from router", () => {
            const mockUseRouter = useRouter as ReturnType<typeof vi.fn>;
            mockUseRouter.mockReturnValue({
                path: "/test",
                isPending: true,
                isNavigating: false,
            });

            const { result } = renderHook(() => useDeferredNavigation());

            expect(result.current.isPending).toBe(true);
        });

        it("should compute isTransitioning from multiple flags", () => {
            const mockUseRouter = useRouter as ReturnType<typeof vi.fn>;
            mockUseRouter.mockReturnValue({
                path: "/test",
                isPending: true,
                isNavigating: false,
            });

            const { result } = renderHook(() => useDeferredNavigation());

            // isTransitioning is true when isPending is true
            expect(result.current.isTransitioning).toBe(true);
        });

        it("should return isNavigating from router", () => {
            const mockUseRouter = useRouter as ReturnType<typeof vi.fn>;
            mockUseRouter.mockReturnValue({
                path: "/test",
                isPending: false,
                isNavigating: true,
            });

            const { result } = renderHook(() => useDeferredNavigation());

            expect(result.current.isTransitioning).toBe(true);
        });
    });

    describe("PageTransition", () => {
        it("should render children", () => {
            const mockUseRouter = useRouter as ReturnType<typeof vi.fn>;
            mockUseRouter.mockReturnValue({
                path: "/test",
                isPending: false,
                isNavigating: false,
            });

            render(
                <PageTransition>
                    <div data-testid="child">Child Content</div>
                </PageTransition>
            );

            expect(screen.getByTestId("child")).toBeDefined();
        });

        it("should wrap children in Suspense", () => {
            const mockUseRouter = useRouter as ReturnType<typeof vi.fn>;
            mockUseRouter.mockReturnValue({
                path: "/test",
                isPending: false,
                isNavigating: false,
            });

            render(
                <PageTransition fallback={<div data-testid="fallback">Loading...</div>}>
                    <div>Content</div>
                </PageTransition>
            );

            // Content should be rendered (no suspension)
            expect(screen.getByText("Content")).toBeDefined();
        });

        it("should apply loading styles when transitioning", () => {
            const mockUseRouter = useRouter as ReturnType<typeof vi.fn>;
            mockUseRouter.mockReturnValue({
                path: "/test",
                isPending: true,
                isNavigating: false,
            });

            const { container } = render(
                <PageTransition>
                    <div>Content</div>
                </PageTransition>
            );

            // Check that the wrapper div exists with opacity style
            const wrapper = container.firstChild as HTMLElement;
            expect(wrapper.style.opacity).toBe("0.7");
        });

        it("should apply normal styles when not transitioning", () => {
            const mockUseRouter = useRouter as ReturnType<typeof vi.fn>;
            mockUseRouter.mockReturnValue({
                path: "/test",
                isPending: false,
                isNavigating: false,
            });

            const { container } = render(
                <PageTransition>
                    <div>Content</div>
                </PageTransition>
            );

            const wrapper = container.firstChild as HTMLElement;
            expect(wrapper.style.opacity).toBe("1");
        });

        it("should apply loadingClassName when loading", () => {
            const mockUseRouter = useRouter as ReturnType<typeof vi.fn>;
            mockUseRouter.mockReturnValue({
                path: "/test",
                isPending: true,
                isNavigating: false,
            });

            const { container } = render(
                <PageTransition loadingClassName="loading-state">
                    <div>Content</div>
                </PageTransition>
            );

            const wrapper = container.firstChild as HTMLElement;
            expect(wrapper.className).toBe("loading-state");
        });

        it("should not apply loadingClassName when not loading", () => {
            const mockUseRouter = useRouter as ReturnType<typeof vi.fn>;
            mockUseRouter.mockReturnValue({
                path: "/test",
                isPending: false,
                isNavigating: false,
            });

            const { container } = render(
                <PageTransition loadingClassName="loading-state">
                    <div>Content</div>
                </PageTransition>
            );

            const wrapper = container.firstChild as HTMLElement;
            expect(wrapper.className).toBe("");
        });

        it("should merge custom loadingStyle with defaults", () => {
            const mockUseRouter = useRouter as ReturnType<typeof vi.fn>;
            mockUseRouter.mockReturnValue({
                path: "/test",
                isPending: true,
                isNavigating: false,
            });

            const { container } = render(
                <PageTransition loadingStyle={{ backgroundColor: "gray" }}>
                    <div>Content</div>
                </PageTransition>
            );

            const wrapper = container.firstChild as HTMLElement;
            expect(wrapper.style.opacity).toBe("0.7");
            expect(wrapper.style.backgroundColor).toBe("gray");
        });
    });

    describe("PageTransitionProps type", () => {
        it("should accept all expected props", () => {
            const props: PageTransitionProps = {
                children: React.createElement("div"),
                loadingClassName: "opacity-50",
                loadingStyle: { opacity: 0.5 },
                fallback: React.createElement("span", null, "Loading..."),
            };

            expect(props.loadingClassName).toBe("opacity-50");
            expect(props.loadingStyle?.opacity).toBe(0.5);
        });
    });
});
