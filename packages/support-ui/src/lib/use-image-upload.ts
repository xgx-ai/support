import { createSignal } from "solid-js";
import { fileToBase64 } from "./file-to-base64";

export interface UploadedImage {
	fileName: string;
	url: string;
}

export type UploadImageFn = (input: {
	fileName: string;
	contentType: string;
	base64: string;
}) => Promise<{ data: string | null; error: string | null }>;

/**
 * Reusable image upload primitive for support issue/comment forms.
 *
 * Encapsulates: file validation, base64 conversion, upload state,
 * image list management, and markdown body building.
 */
export function useImageUpload(uploadImage: UploadImageFn) {
	const [images, setImages] = createSignal<UploadedImage[]>([]);
	const [uploading, setUploading] = createSignal(false);

	const uploadFile = async (file: File) => {
		if (!file.type.startsWith("image/")) return;
		if (file.size > 10 * 1024 * 1024) return;

		setUploading(true);
		try {
			const base64 = await fileToBase64(file);
			const result = await uploadImage({
				fileName: file.name,
				contentType: file.type,
				base64,
			});
			if (result.error) throw new Error(result.error);
			const url = result.data;
			if (url) {
				setImages((prev) => [...prev, { fileName: file.name, url }]);
			}
		} catch (err) {
			console.error("Image upload failed:", err);
		} finally {
			setUploading(false);
		}
	};

	const handlePaste = (e: ClipboardEvent) => {
		const items = e.clipboardData?.items;
		if (!items) return;
		for (const item of items) {
			if (item.type.startsWith("image/")) {
				const file = item.getAsFile();
				if (file) {
					e.preventDefault();
					uploadFile(file);
				}
			}
		}
	};

	const removeImage = (url: string) => {
		setImages((prev) => prev.filter((img) => img.url !== url));
	};

	const reset = () => {
		setImages([]);
	};

	const buildBodyWithImages = (textBody: string): string => {
		const imgs = images();
		if (imgs.length === 0) return textBody;
		const imageMarkdown = imgs
			.map((img) => `![${img.fileName}](${img.url})`)
			.join("\n");
		return `${textBody}\n\n${imageMarkdown}`;
	};

	return {
		images,
		uploading,
		uploadFile,
		handlePaste,
		removeImage,
		reset,
		buildBodyWithImages,
	};
}
