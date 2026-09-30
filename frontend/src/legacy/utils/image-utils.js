export function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 400;
                const scaleSize = Math.min(MAX_WIDTH / img.width, 1);
                canvas.width = Math.round(img.width * scaleSize);
                canvas.height = Math.round(img.height * scaleSize);

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                const dataUrl = canvas.toDataURL('image/webp', 0.7);
                resolve(dataUrl);
            };
        };
        reader.onerror = (error) => reject(error);
    });
}

export function compressImageAsBlob(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 400;
                const scaleSize = Math.min(MAX_WIDTH / img.width, 1);
                canvas.width = Math.round(img.width * scaleSize);
                canvas.height = Math.round(img.height * scaleSize);

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                canvas.toBlob((blob) => {
                    if (blob) {
                        // Change extension to .webp so Multer saves it correctly
                        blob.name = file.name.replace(/\.[^/.]+$/, "") + ".webp";
                        resolve(blob);
                    }
                    else reject(new Error("Error creando blob"));
                }, 'image/webp', 0.7);
            };
        };
        reader.onerror = (error) => reject(error);
    });
}

export function compressProof(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 500;
                const scaleSize = MAX_WIDTH / img.width;
                canvas.width = MAX_WIDTH;
                canvas.height = img.height * scaleSize;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error("Error creando blob"));
                }, 'image/webp', 0.4);
            };
        };
        reader.onerror = (error) => reject(error);
    });
}

export function compressBanner(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 800; // Larger for banners
                const scaleSize = Math.min(MAX_WIDTH / img.width, 1); // Only scale down
                canvas.width = img.width * scaleSize;
                canvas.height = img.height * scaleSize;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                const dataUrl = canvas.toDataURL('image/webp', 0.8); // Higher quality for banner
                resolve(dataUrl);
            };
        };
        reader.onerror = (error) => reject(error);
    });
}
