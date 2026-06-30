"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ImagePage() {
    const router = useRouter();

    useEffect(() => {
        router.replace("/canvas");
    }, [router]);

    return null;
}
