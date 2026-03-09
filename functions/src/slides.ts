import { google, type slides_v1 } from "googleapis";
import * as admin from "firebase-admin";

const PHONE_NUMBER = "5491158529858";

type SlidesAPI = slides_v1.Slides;

async function getSlidesClient(): Promise<{ slides: SlidesAPI; presentationId: string }> {
  const presentationId = process.env.SLIDES_ID;
  if (!presentationId) throw new Error("SLIDES_ID not set");

  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/presentations"],
  });
  const slides = google.slides({ version: "v1", auth });
  return { slides, presentationId };
}

function formatPrice(n: number): string {
  return "$" + n.toLocaleString("es-AR");
}

interface ProductData {
  name: string;
  category: string;
  condition: number;
  listPrice: number;
  photoUrl: string;
  mlLink?: string;
  status: string;
  slideObjectId?: string;
}

export async function syncProductSlide(
  productId: string,
  product: ProductData | null,
): Promise<void> {
  const { slides, presentationId } = await getSlidesClient();

  const existingSlideId = product?.slideObjectId || null;

  // Delete slide if product is not available, has no photo, or was deleted
  if (!product || product.status !== "available" || !product.photoUrl) {
    if (existingSlideId) {
      try {
        await slides.presentations.batchUpdate({
          presentationId,
          requestBody: {
            requests: [{ deleteObject: { objectId: existingSlideId } }],
          },
        });
      } catch (err) {
        console.warn("Failed to delete slide:", err);
      }
      // Clear slideObjectId from Firestore
      await admin.firestore().doc(`products/${productId}`).update({ slideObjectId: admin.firestore.FieldValue.delete() });
    }
    return;
  }

  // Delete old slide if exists (recreate is simpler than updating)
  if (existingSlideId) {
    try {
      await slides.presentations.batchUpdate({
        presentationId,
        requestBody: {
          requests: [{ deleteObject: { objectId: existingSlideId } }],
        },
      });
    } catch {
      // Slide might already be gone
    }
  }

  // Create new slide
  const slideId = `p_${productId.replace(/[^a-zA-Z0-9]/g, "")}`.slice(0, 50);
  await createProductSlide(slides, presentationId, slideId, product);

  // Store slideObjectId in Firestore for future updates
  await admin.firestore().doc(`products/${productId}`).update({ slideObjectId: slideId });
}

async function createProductSlide(
  slides: SlidesAPI,
  presentationId: string,
  slideId: string,
  product: ProductData,
): Promise<void> {
  const photoId = `img_${slideId}`;
  const titleId = `ttl_${slideId}`;
  const priceId = `prc_${slideId}`;
  const detailsId = `dtl_${slideId}`;
  const ctaId = `cta_${slideId}`;

  const waText = encodeURIComponent(
    `Hola! Me interesa: ${product.name} - ${formatPrice(product.listPrice)}` +
    (product.mlLink ? `\n${product.mlLink}` : ""),
  );
  const waUrl = `https://wa.me/${PHONE_NUMBER}?text=${waText}`;

  const ctaLines: string[] = [];
  if (product.mlLink) ctaLines.push(`Comprar en Mercado Libre`);
  ctaLines.push(`Consultar por WhatsApp`);

  const requests: slides_v1.Schema$Request[] = [
    // 1. Create blank slide
    {
      createSlide: {
        objectId: slideId,
        slideLayoutReference: { predefinedLayout: "BLANK" },
      },
    },
    // 2. Product photo (left side)
    {
      createImage: {
        objectId: photoId,
        url: product.photoUrl,
        elementProperties: {
          pageObjectId: slideId,
          size: {
            width: { magnitude: 4000000, unit: "EMU" },
            height: { magnitude: 4000000, unit: "EMU" },
          },
          transform: {
            scaleX: 1, scaleY: 1,
            translateX: 300000, translateY: 500000,
            unit: "EMU",
          },
        },
      },
    },
    // 3. Product name
    {
      createShape: {
        objectId: titleId,
        shapeType: "TEXT_BOX",
        elementProperties: {
          pageObjectId: slideId,
          size: { width: { magnitude: 4400000, unit: "EMU" }, height: { magnitude: 700000, unit: "EMU" } },
          transform: { scaleX: 1, scaleY: 1, translateX: 4700000, translateY: 500000, unit: "EMU" },
        },
      },
    },
    { insertText: { objectId: titleId, text: product.name } },
    {
      updateTextStyle: {
        objectId: titleId,
        style: {
          fontSize: { magnitude: 22, unit: "PT" },
          bold: true,
          foregroundColor: { opaqueColor: { rgbColor: { red: 0.11, green: 0.11, blue: 0.12 } } },
        },
        fields: "fontSize,bold,foregroundColor",
      },
    },
    // 4. Price
    {
      createShape: {
        objectId: priceId,
        shapeType: "TEXT_BOX",
        elementProperties: {
          pageObjectId: slideId,
          size: { width: { magnitude: 4400000, unit: "EMU" }, height: { magnitude: 600000, unit: "EMU" } },
          transform: { scaleX: 1, scaleY: 1, translateX: 4700000, translateY: 1200000, unit: "EMU" },
        },
      },
    },
    { insertText: { objectId: priceId, text: formatPrice(product.listPrice) } },
    {
      updateTextStyle: {
        objectId: priceId,
        style: {
          fontSize: { magnitude: 26, unit: "PT" },
          bold: true,
          foregroundColor: { opaqueColor: { rgbColor: { red: 0.2, green: 0.78, blue: 0.35 } } },
        },
        fields: "fontSize,bold,foregroundColor",
      },
    },
    // 5. Category + condition
    {
      createShape: {
        objectId: detailsId,
        shapeType: "TEXT_BOX",
        elementProperties: {
          pageObjectId: slideId,
          size: { width: { magnitude: 4400000, unit: "EMU" }, height: { magnitude: 400000, unit: "EMU" } },
          transform: { scaleX: 1, scaleY: 1, translateX: 4700000, translateY: 1900000, unit: "EMU" },
        },
      },
    },
    { insertText: { objectId: detailsId, text: `${product.category}  ·  ${product.condition}/10` } },
    {
      updateTextStyle: {
        objectId: detailsId,
        style: {
          fontSize: { magnitude: 14, unit: "PT" },
          foregroundColor: { opaqueColor: { rgbColor: { red: 0.56, green: 0.56, blue: 0.58 } } },
        },
        fields: "fontSize,foregroundColor",
      },
    },
    // 6. CTA links
    {
      createShape: {
        objectId: ctaId,
        shapeType: "TEXT_BOX",
        elementProperties: {
          pageObjectId: slideId,
          size: { width: { magnitude: 4400000, unit: "EMU" }, height: { magnitude: 1000000, unit: "EMU" } },
          transform: { scaleX: 1, scaleY: 1, translateX: 4700000, translateY: 2600000, unit: "EMU" },
        },
      },
    },
    { insertText: { objectId: ctaId, text: ctaLines.join("\n") } },
    {
      updateTextStyle: {
        objectId: ctaId,
        style: {
          fontSize: { magnitude: 13, unit: "PT" },
          foregroundColor: { opaqueColor: { rgbColor: { red: 0, green: 0.48, blue: 1 } } },
        },
        fields: "fontSize,foregroundColor",
      },
    },
  ];

  // Add hyperlinks to CTA
  let charOffset = 0;
  if (product.mlLink) {
    const mlText = "Comprar en Mercado Libre";
    requests.push({
      updateTextStyle: {
        objectId: ctaId,
        style: { link: { url: product.mlLink } },
        textRange: { startIndex: charOffset, endIndex: charOffset + mlText.length, type: "FIXED_RANGE" },
        fields: "link",
      },
    });
    charOffset += mlText.length + 1; // +1 for newline
  }
  const waTextLabel = "Consultar por WhatsApp";
  requests.push({
    updateTextStyle: {
      objectId: ctaId,
      style: { link: { url: waUrl } },
      textRange: { startIndex: charOffset, endIndex: charOffset + waTextLabel.length, type: "FIXED_RANGE" },
      fields: "link",
    },
  });

  await slides.presentations.batchUpdate({
    presentationId,
    requestBody: { requests },
  });
}
